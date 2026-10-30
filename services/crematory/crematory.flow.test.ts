import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, type PDFPage } from 'pdf-lib';

/**
 * Send to Crematory (2026-10), end to end in mock mode: fictional cases,
 * fictional PDFs, document storage in memory, Microsoft Graph faked, and
 * only fictional recipients (crematory.example). Nothing leaves the test.
 */
const { blobs } = vi.hoisted(() => ({ blobs: new Map<string, { buffer: Buffer; contentType: string }>() }));
vi.mock('../../lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: async (key: string, contents: Buffer, contentType: string) => (blobs.set(key, { buffer: Buffer.from(contents), contentType }), { storageKey: key }),
    downloadFile: async (key: string) => {
      const blob = blobs.get(key);
      if (!blob) throw new Error(`no blob ${key}`);
      return { buffer: Buffer.from(blob.buffer), contentType: blob.contentType };
    },
    deleteFile: async () => undefined,
  },
}));

/** Send to Crematory checklist (2026-10): lets a test make saving the
    checklist fail after a successful send. */
const sentChecklistFault = vi.hoisted(() => ({ fail: false }));
vi.mock('./crematorySentChecklist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./crematorySentChecklist')>();
  return {
    ...actual,
    completeCrematorySentChecklist: (...args: Parameters<typeof actual.completeCrematorySentChecklist>) =>
      sentChecklistFault.fail ? Promise.reject(new Error('Wix 503 while saving the case')) : actual.completeCrematorySentChecklist(...args),
  };
});

const pkg = await import('./crematoryPackageService');
const { completeCrematorySentChecklist, retryCrematorySentChecklist } = await import('./crematorySentChecklist');
const { crematorySendState } = await import('@/domain/crematory/sendState');
const { sendCrematoryPackages, reviewCrematorySend } = await import('./crematorySendService');
const { connectMockCrematoryMailbox, resetMockCrematoryMailboxes } = await import('./crematoryMailboxService');
const { upload } = await import('../documentService');
const { extractArrangementPage } = await import('../arrangementPageExtractService');
const { caseFixtures } = await import('../__mocks__/fixtures');
const { caseDocumentFixtures } = await import('../__mocks__/documentFixtures');
const { activityEventFixtures } = await import('../__mocks__/activityEventFixtures');
const { appointmentFixtures } = await import('../__mocks__/schedulingFixtures');
const { DEFAULT_ORGANIZATION_ID } = await import('../__mocks__/organizationIds');
import type { Case } from '@/types/case';
import type { Appointment } from '@/types/appointment';

const ORG = DEFAULT_ORGANIZATION_ID;
const ctx = (actorIdentityId = 'staff-dana') => ({ organizationId: ORG, actorIdentityId, actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr' });
const SIGNATURE_PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

async function pdf(label: string, pages: number, size: [number, number] = [612, 792]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const signature = await doc.embedPng(SIGNATURE_PNG);
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage(size);
    page.drawText(`${label} page ${n}`, { x: 72, y: 700, size: 14, font });
    page.drawImage(signature, { x: 72, y: 600, width: 120, height: 40 });
  }
  return Buffer.from(await doc.save());
}
const loadPdf = (bytes: Uint8Array) => PDFDocument.load(new Uint8Array(bytes));
async function contentOf(page: PDFPage) {
  const contents = page.node.Contents();
  const streams = contents && 'asArray' in contents ? contents.asArray() : [contents];
  return streams.map((ref) => Buffer.from((page.doc.context.lookup(ref as never) as PDFRawStream).getContents()).toString('hex')).join('|');
}
void PDFName;

/** Two fictional Manors cases, each with a Manors-shaped workflow 2/3. */
/** packageName: [first name(s), ...last name words] as staff confirm them. */
const CASES = [
  { id: '1042', name: 'RICHARD REYNOLDS', number: 'B2026-901', packageName: ['Richard', 'Reynolds'] },
  { id: '1044', name: 'ESTELA SALAS RUEDA', number: 'B2026-902', packageName: ['Estela', 'Salas', 'Rueda'] },
];
const originals = new Map<string, Case>();
const index = (id: string) => caseFixtures.findIndex((c) => c.id === id && c.organizationId === ORG);

function prepareCase(id: string, name: string, number: string) {
  const base = caseFixtures[index(id)];
  originals.set(id, base);
  const stage = base.workflowSnapshot!.stages[0];
  const item = (i: number, label: string) => ({ ...stage.checklist.items[0], index: i, label, hasField: false, requiredCaseFields: undefined });
  caseFixtures[index(id)] = {
    ...base,
    decedentName: name,
    caseNumber: number,
    caseType: 'cremation',
    isDeleted: false,
    isMedicalExaminerCase: false,
    pickupStatus: 'awaiting_pickup',
    slaEvents: {},
    crematory: undefined,
    checklistState: { '2:0': true, '2:1': true, '2:2': true },
    workflowSnapshot: {
      ...base.workflowSnapshot!,
      stages: [
        ...base.workflowSnapshot!.stages.filter((s) => s.displayStage !== 2 && s.displayStage !== 3),
        { ...stage, displayStage: 2, checklist: { ...stage.checklist, items: [item(0, 'EDRS submitted & sent to doctor'), item(1, 'Cause of death entered'), item(2, 'Hardsave for state approval if not an online doctor')] } },
        { ...stage, displayStage: 3, checklist: { ...stage.checklist, items: [item(0, 'Permit sent to crematory'), item(1, 'Authorization of release sent to crematory')] } },
      ],
    },
  };
}

function expectedPickup(caseId: string, isoDate: string) {
  appointmentFixtures.push({
    id: `cremains-pickup-${caseId}`,
    organizationId: ORG,
    caseId,
    appointmentType: 'cremains.pickup.expected',
    title: 'Expected pickup',
    status: 'scheduled',
    startAt: `${isoDate}T05:00:00.000Z`,
    endAt: `${isoDate}T23:00:00.000Z`,
    timezone: 'America/New_York',
  } as unknown as Appointment);
}

async function uploadAs(caseId: string, fileName: string, documentTypeKey: string, bytes: Buffer, id: string) {
  return upload({ caseId, fileName, mimeType: 'application/pdf', documentTypeKey, idFactory: () => id }, bytes, ctx(), 'mock');
}

/** Everything a case needs — the last confirmation also builds the package (2026-10, automatic). */
async function readyCase(caseId: string, readyDate = '11/06/2026', iso = '2026-11-06') {
  const arrangement = await pdf(`ARRANGEMENT-${caseId}`, 6);
  await uploadAs(caseId, 'Arrangement Forms.pdf', 'external_form.arrangement_forms', arrangement, `arr-${caseId}`);
  const permit = await pdf(`PERMIT-${caseId}`, 2, [612, 1008]);
  const permitDoc = await uploadAs(caseId, 'State Permit.pdf', 'cremation_form.state_permit', permit, `permit-${caseId}`);
  expectedPickup(caseId, iso);
  await pkg.confirmPermit(ctx(), caseId, shown(permitDoc.id), 'mock');
  await extractArrangementPage('crematory_form', caseId, {}, ctx(), 'mock');
  await pkg.confirmReadyDate(ctx(), caseId, readyDate, 'mock');
  const [first, ...rest] = CASES.find((c) => c.id === caseId)!.packageName;
  await pkg.confirmPackageName(ctx(), caseId, { first, last: rest.join(' ') }, 'mock');
  return { arrangement, permit };
}

let lengths = { documents: 0, activity: 0, appointments: 0 };
beforeEach(() => {
  lengths = { documents: caseDocumentFixtures.length, activity: activityEventFixtures.length, appointments: appointmentFixtures.length };
  for (const c of CASES) prepareCase(c.id, c.name, c.number);
  resetMockCrematoryMailboxes();
});
afterEach(() => {
  for (const [id, original] of originals) caseFixtures[index(id)] = original;
  caseDocumentFixtures.length = lengths.documents;
  activityEventFixtures.length = lengths.activity;
  appointmentFixtures.length = lengths.appointments;
  blobs.clear();
  vi.unstubAllGlobals();
  sentChecklistFault.fail = false;
});

/** What SOLIS showed staff before they confirmed or chose a permit: that document's stored checksum (2026-10). */
const shown = (documentId: string) => ({ documentId, displayedChecksumSha256: caseDocumentFixtures.find((d) => d.id === documentId)?.checksumSha256 ?? null });
const docsOf = (caseId: string, type: string) => caseDocumentFixtures.filter((d) => d.caseId === caseId && d.documentTypeKey === type).sort((a, b) => Number(a.version) - Number(b.version));
const eventsOf = (caseId: string, type: string) => activityEventFixtures.slice(lengths.activity).filter((e) => e.caseId === caseId && e.eventType === type);

describe('readiness — what needs attention', () => {
  it('a bare case lists every missing piece; nothing is sent or built on its own', async () => {
    const summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.readiness.readyToBuild).toBe(false);
    expect(summary.readiness.requirements.filter((r) => !r.ok).map((r) => r.key)).toEqual(['permit_uploaded', 'permit_verified', 'crematory_form', 'package_name', 'ready_date', 'package']);
    // A two-word case name can only be first + last: it is filled in for staff to confirm.
    expect(summary.packageName).toEqual({ confirmed: null, suggested: { first: 'Richard', last: 'Reynolds' }, suggestedFrom: 'case_name', recordedFrom: null });
    expect(docsOf('1042', 'cremation_form.crematory_package')).toHaveLength(0);
  });

  it('uploading a permit does nothing by itself — it must be confirmed', async () => {
    await uploadAs('1042', 'State Permit.pdf', 'cremation_form.state_permit', await pdf('PERMIT', 1), 'permit-x');
    const summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.readiness.requirements.find((r) => r.key === 'permit_verified')).toMatchObject({ ok: false });
    expect(docsOf('1042', 'cremation_form.crematory_package')).toHaveLength(0);
  });

  it('the expected ready date is suggested from the Expected Pickup but never taken as confirmed', async () => {
    expectedPickup('1042', '2026-11-06');
    const summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.readyDate).toEqual({ suggested: '11/06/2026', confirmed: null, recordedFrom: null });
    expect(summary.readiness.requirements.find((r) => r.key === 'ready_date')).toMatchObject({ ok: false });
  });

  it('workflow 2 is required to SEND, not to build (2026-10): the package is prepared, and the exact unchecked steps are named', async () => {
    caseFixtures[index('1042')] = { ...caseFixtures[index('1042')], checklistState: { '2:0': true } };
    await readyCase('1042');
    expect(docsOf('1042', 'cremation_form.crematory_package')).toHaveLength(1);
    const summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.readiness).toMatchObject({ readyToBuild: true, readyToSend: false });
    expect(summary.package).toMatchObject({ current: true });
    expect(summary.readiness.requirements.filter((r) => !r.ok)).toEqual([
      { key: 'workflow_2', label: 'Workflow 2 complete', ok: false, detail: 'Not yet checked on the case: Cause of death entered · Attestation Received / Hard Saved.' },
    ]);
    expect(summary.workflow2).toEqual({ displayStage: 2, medicalExaminer: false, missing: ['Cause of death entered', 'Attestation Received / Hard Saved'] });
    await expect(reviewCrematorySend(ORG, ['1042'], 'mock')).rejects.toMatchObject({ status: 422, message: expect.stringContaining('Workflow 2 complete') });
    // Nothing on the workflow was checked by SOLIS.
    expect(caseFixtures[index('1042')].checklistState).toEqual({ '2:0': true });
  });

  it('a Medical Examiner case needs the ME verification steps — never the doctor steps — including a case switched to ME after doctor steps were checked', async () => {
    // As the doctor-workflow steps were checked before the case was marked ME.
    caseFixtures[index('1042')] = { ...caseFixtures[index('1042')], isMedicalExaminerCase: true, checklistState: { '2:1': true, '2:2': true } };
    await readyCase('1042');
    let summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.workflow2).toEqual({ displayStage: 2, medicalExaminer: true, missing: ['Medical Examiner EDRS entry verified', 'Medical Examiner cause of death verified', 'Required ME information confirmed'] });
    expect(summary.readiness.requirements.find((r) => r.key === 'workflow_2')!.detail).toBe(
      'Medical Examiner case — not yet checked on the case: Medical Examiner EDRS entry verified · Medical Examiner cause of death verified · Required ME information confirmed.',
    );
    expect(summary.readiness.requirements.find((r) => r.key === 'workflow_2')!.detail).not.toMatch(/doctor/i);
    expect(summary.readiness).toMatchObject({ readyToBuild: true, readyToSend: false });

    // Staff check the ME steps on the case: complete. The doctor ticks are kept, not counted.
    caseFixtures[index('1042')] = { ...caseFixtures[index('1042')], checklistState: { '2:1': true, '2:2': true, '2:3': true, '2:4': true, '2:5': true } };
    summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.workflow2!.missing).toEqual([]);
    expect(summary.readiness.readyToSend).toBe(true);

    // Back to a standard case: the doctor steps count again — "EDRS submitted & sent to doctor" was never checked.
    caseFixtures[index('1042')] = { ...caseFixtures[index('1042')], isMedicalExaminerCase: false };
    summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.workflow2).toMatchObject({ medicalExaminer: false, missing: ['EDRS submitted & sent to doctor'] });
  });
});

describe('automatic preparation — from what is already on the case (2026-10)', () => {
  const FORM = 'external_form.crematory_form';
  const PACKAGE = 'cremation_form.crematory_package';
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  it('an Arrangement Form is all page 3 needs — saved automatically, even before the permit; the package waits and says why', async () => {
    const arrangement = await pdf('ARRANGEMENT-1042', 6);
    await uploadAs('1042', 'Arrangement Forms.pdf', 'external_form.arrangement_forms', arrangement, 'arr-1042');
    expect(await pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock')).toEqual({ crematoryForm: 'saved', package: 'needs_attention' });
    const [page3] = docsOf('1042', FORM);
    const saved = await loadPdf(blobs.get(page3.storageKey)!.buffer);
    expect(saved.getPageCount()).toBe(1);
    expect(await contentOf(saved.getPage(0))).toBe(await contentOf((await loadPdf(arrangement)).getPage(2)));
    // The original Arrangement Form is kept, unchanged.
    expect(createHash('sha256').update(blobs.get(docsOf('1042', 'external_form.arrangement_forms')[0].storageKey)!.buffer).digest('hex')).toBe(createHash('sha256').update(arrangement).digest('hex'));
    // Nothing new the second time; no package without a confirmed permit, name and date.
    expect(await pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock')).toEqual({ crematoryForm: 'unchanged', package: 'needs_attention' });
    expect(docsOf('1042', FORM)).toHaveLength(1);
    expect(docsOf('1042', PACKAGE)).toHaveLength(0);
    const summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.readiness.requirements.filter((r) => !r.ok).map((r) => r.key)).toEqual(['permit_uploaded', 'permit_verified', 'package_name', 'ready_date', 'package']);
  });

  it('a replaced Arrangement Form refreshes page 3 and rebuilds the package; earlier versions stay in History', async () => {
    await readyCase('1042');
    expect(docsOf('1042', PACKAGE)).toHaveLength(1);
    await tick();
    const corrected = await pdf('ARRANGEMENT-1042-CORRECTED', 6);
    await uploadAs('1042', 'Arrangement Forms.pdf', 'external_form.arrangement_forms', corrected, 'arr-1042-b');
    expect(await pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock')).toEqual({ crematoryForm: 'saved', package: 'saved' });
    expect(docsOf('1042', FORM).map((d) => [d.version, d.status])).toEqual([[1, 'superseded'], [2, 'active']]);
    expect(docsOf('1042', PACKAGE).map((d) => [d.version, d.status])).toEqual([[1, 'superseded'], [2, 'active']]);
    const rebuilt = await loadPdf(blobs.get(docsOf('1042', PACKAGE)[1].storageKey)!.buffer);
    expect(await contentOf(rebuilt.getPage(2))).toBe(await contentOf((await loadPdf(corrected)).getPage(2)));
    expect((await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock')).readiness.readyToSend).toBe(true);
  });

  it('a case already sent is never touched — a changed source never leads to a new package or a resend', async () => {
    await readyCase('1042');
    const c = caseFixtures[index('1042')];
    caseFixtures[index('1042')] = {
      ...c,
      crematory: { ...c.crematory!, lastSubmission: { submissionId: 's1', status: 'submitted', packageDocumentId: docsOf('1042', PACKAGE)[0].id, packageVersion: 1, attachmentName: 'x.pdf', to: ['intake@crematory.example'], cc: [], mailbox: 'office@funeralhome.example', internetMessageId: null, error: null, at: '2026-10-27T15:00:00.000Z', by: 'staff-lee' } },
    };
    await tick();
    await uploadAs('1042', 'Arrangement Forms.pdf', 'external_form.arrangement_forms', await pdf('ARRANGEMENT-NEW', 6), 'arr-1042-c');
    expect(await pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock')).toEqual({ crematoryForm: 'not_needed', package: 'not_needed' });
    expect(docsOf('1042', FORM)).toHaveLength(1);
    expect(docsOf('1042', PACKAGE)).toHaveLength(1);
  });

  it('a case whose send is unclear, or being sent right now, is not touched either', async () => {
    await readyCase('1042');
    const base = caseFixtures[index('1042')];
    const pkgId = docsOf('1042', PACKAGE)[0].id;
    await tick();
    await uploadAs('1042', 'Arrangement Forms.pdf', 'external_form.arrangement_forms', await pdf('ARRANGEMENT-NEW', 6), 'arr-1042-e');
    for (const crematory of [
      { ...base.crematory!, lastSubmission: { submissionId: 's1', status: 'uncertain' as const, packageDocumentId: pkgId, packageVersion: 1, attachmentName: 'x.pdf', to: [], cc: [], mailbox: null, internetMessageId: null, error: 'timeout', at: '2026-10-27T15:00:00.000Z', by: 'staff-lee' } },
      { ...base.crematory!, pendingSubmission: { submissionId: 's2', startedAt: new Date().toISOString(), startedBy: 'staff-lee' } },
    ]) {
      caseFixtures[index('1042')] = { ...base, crematory };
      expect(await pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock')).toEqual({ crematoryForm: 'not_needed', package: 'not_needed' });
    }
    expect(docsOf('1042', FORM)).toHaveLength(1);
    expect(docsOf('1042', PACKAGE)).toHaveLength(1);
  });

  it('two preparations at once make one new version, not two', async () => {
    await readyCase('1042');
    await tick();
    await uploadAs('1042', 'Arrangement Forms.pdf', 'external_form.arrangement_forms', await pdf('ARRANGEMENT-1042-B', 6), 'arr-1042-d');
    const results = await Promise.all([pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock'), pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock')]);
    expect(results).toEqual([{ crematoryForm: 'saved', package: 'saved' }, { crematoryForm: 'unchanged', package: 'unchanged' }]);
    expect(docsOf('1042', FORM)).toHaveLength(2);
    expect(docsOf('1042', PACKAGE)).toHaveLength(2);
  });

  it('the package is ready before workflow 2 is complete; completing it later rebuilds nothing and makes the case ready to send', async () => {
    const complete = caseFixtures[index('1042')].checklistState;
    caseFixtures[index('1042')] = { ...caseFixtures[index('1042')], checklistState: { '2:0': true } };
    await readyCase('1042');
    expect(docsOf('1042', PACKAGE).map((d) => [d.version, d.fileName])).toEqual([[1, 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf']]);
    const before = caseFixtures[index('1042')];
    caseFixtures[index('1042')] = { ...before, checklistState: complete };
    const { regenerateOfficialDocumentsAfterCaseChange } = await import('../automaticCaseDocuments');
    await regenerateOfficialDocumentsAfterCaseChange(before, caseFixtures[index('1042')], ctx(), 'mock');
    expect(docsOf('1042', PACKAGE)).toHaveLength(1);
    expect((await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock')).readiness.readyToSend).toBe(true);
  });

  it('across servers: while another server holds the case, nothing is saved here; once it lets go (or its lease expires), this one prepares', async () => {
    await uploadAs('1042', 'Arrangement Forms.pdf', 'external_form.arrangement_forms', await pdf('ARRANGEMENT-1042', 6), 'arr-1042');
    const hold = (until: number) => {
      const c = caseFixtures[index('1042')];
      caseFixtures[index('1042')] = { ...c, crematory: { ...(c.crematory ?? {}), preparing: { token: 'other-server', until: new Date(until).toISOString() } } };
    };
    // Held, and still held when this server stops waiting: nothing is saved here.
    hold(Date.now() + 60_000);
    expect(await pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock', { waitMs: 30, pollMs: 10 })).toEqual({ crematoryForm: 'unchanged', package: 'unchanged' });
    expect(docsOf('1042', FORM)).toHaveLength(0);

    // Released while this server waits: it then prepares, and lets go itself.
    setTimeout(() => {
      const c = caseFixtures[index('1042')];
      caseFixtures[index('1042')] = { ...c, crematory: { ...c.crematory!, preparing: null } };
    }, 30);
    expect((await pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock', { waitMs: 2_000, pollMs: 10 })).crematoryForm).toBe('saved');
    expect(docsOf('1042', FORM)).toHaveLength(1);
    expect(caseFixtures[index('1042')].crematory!.preparing).toBeNull();

    // A lease left behind by a server that stopped mid-way expires.
    await tick();
    await uploadAs('1042', 'Arrangement Forms.pdf', 'external_form.arrangement_forms', await pdf('ARRANGEMENT-1042-B', 6), 'arr-1042-b');
    hold(Date.now() - 1);
    expect((await pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock', { waitMs: 30, pollMs: 10 })).crematoryForm).toBe('saved');
    expect(docsOf('1042', FORM)).toHaveLength(2);
  });

  it('nothing to do: no lease is taken and the case is not written', async () => {
    await readyCase('1042');
    const before = caseFixtures[index('1042')];
    expect(await pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock')).toEqual({ crematoryForm: 'unchanged', package: 'unchanged' });
    expect(caseFixtures[index('1042')]).toBe(before);
  });

  it('only for organizations with Send to Crematory, and only their own cases', async () => {
    await uploadAs('1042', 'Arrangement Forms.pdf', 'external_form.arrangement_forms', await pdf('ARRANGEMENT-1042', 6), 'arr-1042');
    const other = { ...ctx(), organizationId: 'gus-camacho-jr' };
    expect(await pkg.prepareCrematoryDocuments(other, '1042', 'mock')).toEqual({ crematoryForm: 'not_needed', package: 'not_needed' });
    expect(docsOf('1042', FORM)).toHaveLength(0);
  });
});

describe('choosing a document already on the case (2026-10)', () => {
  const untyped = (caseId: string, fileName: string, bytes: Buffer, id: string, mimeType = 'application/pdf') =>
    upload({ caseId, fileName, mimeType, idFactory: () => id }, bytes, ctx(), 'mock');
  const pick = ({ storageKey, checksumSha256, version, category, fileName, mimeType, status, origin, createdAt }: Record<string, unknown>) => ({ storageKey, checksumSha256, version, category, fileName, mimeType, status, origin, createdAt });

  it('an untyped permit is listed (suggested by its name, never chosen); choosing it sets only its type, and it still needs confirming', async () => {
    const permit = await untyped('1042', 'FICTIONAL PERMIT.pdf', await pdf('PERMIT-1042', 2, [612, 1008]), 'permit-untyped');
    await untyped('1042', 'Fictional Payment.pdf', await pdf('PAYMENT', 1), 'payment-untyped');
    let summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.readiness.requirements.find((r) => r.key === 'permit_uploaded')!.ok).toBe(false);
    expect(summary.untypedDocuments.map((d) => [d.fileName, d.suggestedAs])).toEqual(expect.arrayContaining([['FICTIONAL PERMIT.pdf', 'state_permit'], ['Fictional Payment.pdf', null]]));
    // Preparing never classifies it from its name.
    await pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock');
    expect(caseDocumentFixtures.find((d) => d.id === permit.id)!.documentTypeKey).toBeNull();

    const before = pick(caseDocumentFixtures.find((d) => d.id === permit.id)! as never);
    summary = await pkg.assignSourceDocument(ctx(), '1042', permit.id, 'state_permit', 'mock', true, shown(permit.id).displayedChecksumSha256);
    const after = caseDocumentFixtures.find((d) => d.id === permit.id)!;
    expect(after.documentTypeKey).toBe('cremation_form.state_permit');
    expect(pick(after as never)).toEqual(before);
    expect(summary.permit).toMatchObject({ documentId: permit.id, fileName: 'FICTIONAL PERMIT.pdf' });
    expect(summary.readiness.requirements.filter((r) => ['permit_uploaded', 'permit_verified'].includes(r.key)).map((r) => [r.key, r.ok])).toEqual([['permit_uploaded', true], ['permit_verified', false]]);
    expect(summary.untypedDocuments.map((d) => d.fileName)).toEqual(['Fictional Payment.pdf']);
    expect(eventsOf('1042', 'crematory.document_type_assigned')[0].description).toBe('"FICTIONAL PERMIT.pdf" chosen as the State Cremation Permit (document type set; the file is unchanged)');
    expect(docsOf('1042', 'cremation_form.crematory_package')).toHaveLength(0);
    expect(caseFixtures[index('1042')].crematory!.preparing).toBeNull();
  });

  it('an untyped Arrangement Form, once chosen, has page 3 prepared at once', async () => {
    const arrangement = await pdf('ARRANGEMENT-1042', 6);
    const doc = await untyped('1042', 'Cremations-Arrangement-Fictional-Forms.pdf', arrangement, 'arr-untyped');
    expect((await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock')).untypedDocuments[0].suggestedAs).toBe('arrangement_forms');
    await pkg.assignSourceDocument(ctx(), '1042', doc.id, 'arrangement_forms', 'mock');
    const [page3] = docsOf('1042', 'external_form.crematory_form');
    expect(await contentOf((await loadPdf(blobs.get(page3.storageKey)!.buffer)).getPage(0))).toBe(await contentOf((await loadPdf(arrangement)).getPage(2)));
  });

  it('refuses — writing nothing — another case\'s document, a non-PDF, a typed document, a second permit, a sent case, and another organization', async () => {
    const other = await untyped('1044', 'OTHER CASE PERMIT.pdf', await pdf('P', 1), 'permit-other-case');
    await expect(pkg.assignSourceDocument(ctx(), '1042', other.id, 'state_permit', 'mock', false, shown(other.id).displayedChecksumSha256)).rejects.toMatchObject({ status: 409 });
    const image = await untyped('1042', 'permit.png', Buffer.from('\x89PNG fictional'), 'permit-png', 'image/png');
    await expect(pkg.assignSourceDocument(ctx(), '1042', image.id, 'state_permit', 'mock', false, shown(image.id).displayedChecksumSha256)).rejects.toMatchObject({ status: 409 });
    const typed = await uploadAs('1042', 'Typed Permit.pdf', 'cremation_form.state_permit', await pdf('P2', 1), 'permit-typed');
    await expect(pkg.assignSourceDocument(ctx(), '1042', typed.id, 'arrangement_forms', 'mock')).rejects.toMatchObject({ status: 409 });
    const second = await untyped('1042', 'ANOTHER PERMIT.pdf', await pdf('P3', 1), 'permit-second');
    await expect(pkg.assignSourceDocument(ctx(), '1042', second.id, 'state_permit', 'mock', false, shown(second.id).displayedChecksumSha256)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('already has a State Cremation Permit') });
    expect(caseDocumentFixtures.find((d) => d.id === second.id)!.documentTypeKey).toBeNull();
    expect(caseDocumentFixtures.find((d) => d.id === other.id)!.documentTypeKey).toBeNull();

    const c = caseFixtures[index('1044')];
    caseFixtures[index('1044')] = { ...c, crematory: { lastSubmission: { submissionId: 's', status: 'submitted', packageDocumentId: 'x', packageVersion: 1, attachmentName: 'x.pdf', to: [], cc: [], mailbox: null, internetMessageId: null, error: null, at: '2026-10-27T15:00:00.000Z', by: null } } };
    await expect(pkg.assignSourceDocument(ctx(), '1044', other.id, 'state_permit', 'mock', false, shown(other.id).displayedChecksumSha256)).rejects.toMatchObject({ status: 409 });
    await expect(pkg.assignSourceDocument({ ...ctx(), organizationId: 'gus-camacho-jr' }, '1044', other.id, 'state_permit', 'mock')).rejects.toMatchObject({ status: 404 });
    expect(caseDocumentFixtures.find((d) => d.id === other.id)!.documentTypeKey).toBeNull();
    expect(eventsOf('1042', 'crematory.document_type_assigned')).toHaveLength(0);
  });
});

describe('the Crematory Package — one PDF per decedent', () => {
  it('puts every permit page first, then Arrangement Form page 3 — unchanged — under LASTNAME_FIRSTNAME_CREMATORY_PACKAGE_MM-DD-YYYY.pdf', async () => {
    const { permit, arrangement } = await readyCase('1042');
    // Built automatically by the last confirmation; building again changes nothing.
    const { outcome, summary } = await pkg.buildCrematoryPackage(ctx(), '1042', 'mock', true);
    expect(outcome).toBe('unchanged');
    expect(summary.readiness.readyToSend).toBe(true);
    // Without the send permission the package is built but not sendable.
    expect((await pkg.getCrematoryCaseSummary(ORG, '1042', false, 'mock')).readiness).toMatchObject({ readyToBuild: true, readyToSend: false });
    const [saved] = docsOf('1042', 'cremation_form.crematory_package');
    expect(saved).toMatchObject({ fileName: 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf', mimeType: 'application/pdf', version: 1, status: 'active', generatedBy: 'staff-dana' });

    const merged = await loadPdf(blobs.get(saved.storageKey)!.buffer);
    const permitPdf = await loadPdf(permit);
    const arrangementPdf = await loadPdf(arrangement);
    expect(merged.getPageCount()).toBe(3);
    expect(await contentOf(merged.getPage(0))).toBe(await contentOf(permitPdf.getPage(0)));
    expect(await contentOf(merged.getPage(1))).toBe(await contentOf(permitPdf.getPage(1)));
    expect(await contentOf(merged.getPage(2))).toBe(await contentOf(arrangementPdf.getPage(2)));
    expect(merged.getPage(0).getSize()).toEqual({ width: 612, height: 1008 });
    expect(eventsOf('1042', 'crematory.package_built')[0].description).toBe('Crematory Package v1 built: REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf');
  });

  it('MARY ANN SMITH is named from the confirmed parts — Smith_Mary Ann — and the case name is never changed', async () => {
    caseFixtures[index('1042')] = { ...caseFixtures[index('1042')], decedentName: 'MARY ANN SMITH' };
    await readyCase('1042');
    await pkg.confirmPackageName(ctx(), '1042', { first: 'Mary Ann', last: 'Smith' }, 'mock');
    await pkg.buildCrematoryPackage(ctx(), '1042', 'mock');
    // Confirming the corrected name rebuilt the package automatically under it.
    expect(docsOf('1042', 'cremation_form.crematory_package').at(-1)!.fileName).toBe('SMITH_MARY ANN_CREMATORY_PACKAGE_11-06-2026.pdf');
    expect(caseFixtures[index('1042')].decedentName).toBe('MARY ANN SMITH');
    expect(eventsOf('1042', 'crematory.package_name_confirmed').at(-1)!.description).toBe('Name for the Crematory Package confirmed: Smith, Mary Ann (was Reynolds, Richard)');
  });

  it('suggests the name only from the intake form\'s own first / middle / last boxes', async () => {
    const { externalFormSubmissionFixtures } = await import('../__mocks__/externalFormFixtures');
    const before = externalFormSubmissionFixtures.length;
    externalFormSubmissionFixtures.push({
      id: 'sub-name', organizationId: ORG, provider: 'jotform', externalFormId: '262664842044055', externalSubmissionId: '1', caseFormLinkId: null,
      createdCaseId: '1042', status: 'matched', receivedAt: '2026-10-20T10:00:00.000Z',
      mappedFields: JSON.stringify({ decedentName: 'MARY ANN SMITH', decedentFirstName: 'MARY', decedentMiddleName: 'ANN', decedentLastName: 'SMITH' }),
    } as never);
    try {
      expect((await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock')).packageName).toEqual({ confirmed: null, suggested: { first: 'Mary Ann', last: 'Smith' }, suggestedFrom: 'form', recordedFrom: null });
    } finally {
      externalFormSubmissionFixtures.length = before;
    }
  });

  it('for an older submission, reads the name boxes back from Jotform (read-only); a long case name alone is never split', async () => {
    caseFixtures[index('1042')] = { ...caseFixtures[index('1042')], decedentName: 'MARY ANN SMITH', decedentMiddleName: null };
    // Without any form, "MARY ANN SMITH" is ambiguous: nothing is filled in.
    expect((await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock')).packageName).toEqual({ confirmed: null, suggested: null, suggestedFrom: null, recordedFrom: null });

    const { externalFormSubmissionFixtures } = await import('../__mocks__/externalFormFixtures');
    const before = externalFormSubmissionFixtures.length;
    externalFormSubmissionFixtures.push({
      id: 'sub-old', organizationId: ORG, provider: 'jotform', externalFormId: '261945978664175', externalSubmissionId: '6600000000000000001', caseFormLinkId: null,
      createdCaseId: '1042', status: 'matched', receivedAt: '2026-10-01T10:00:00.000Z',
      mappedFields: JSON.stringify({ decedentName: 'MARY SMITH', decedentMiddleName: 'ANN' }), // received before name boxes were kept
    } as never);
    vi.stubEnv('JOTFORM_API_KEY', 'test-key');
    const jotform = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.jotform.com/submission/6600000000000000001');
      return new Response(JSON.stringify({ responseCode: 200, content: { form_id: '261945978664175', created_at: '2026-10-01 10:00:00', answers: { '87': { answer: { first: 'MARY', middle: 'ANN', last: 'SMITH' } } } } }));
    });
    vi.stubGlobal('fetch', jotform);
    try {
      expect((await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock')).packageName).toEqual({ confirmed: null, suggested: { first: 'Mary Ann', last: 'Smith' }, suggestedFrom: 'form', recordedFrom: null });
      await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
      expect(jotform).toHaveBeenCalledTimes(1); // read once, then remembered
    } finally {
      externalFormSubmissionFixtures.length = before;
      vi.unstubAllEnvs();
    }
  });

  it('refuses an incomplete name', async () => {
    await expect(pkg.confirmPackageName(ctx(), '1042', { first: 'Mary Ann', last: ' ' }, 'mock')).rejects.toMatchObject({ status: 422 });
  });

  it('keeps multi-word surnames whole in the file name', async () => {
    await readyCase('1044', '11/07/2026', '2026-11-07');
    await pkg.buildCrematoryPackage(ctx(), '1044', 'mock');
    expect(docsOf('1044', 'cremation_form.crematory_package')[0].fileName).toBe('SALAS RUEDA_ESTELA_CREMATORY_PACKAGE_11-07-2026.pdf');
  });

  it('building again with nothing changed creates nothing; a new permit, a new date or a newer page 3 each need review and a rebuild', async () => {
    await readyCase('1042');
    await pkg.buildCrematoryPackage(ctx(), '1042', 'mock');
    expect((await pkg.buildCrematoryPackage(ctx(), '1042', 'mock')).outcome).toBe('unchanged');
    expect(docsOf('1042', 'cremation_form.crematory_package')).toHaveLength(1);

    // A corrected permit (replacing the first): unconfirmed until staff confirm it; the old package is stale.
    const { document: newPermit } = await pkg.addPermit(ctx(), '1042', { fileName: 'State Permit (corrected).pdf', mimeType: 'application/pdf', bytes: await pdf('PERMIT-2', 1) }, { replacesDocumentId: 'permit-1042', mayReplace: true }, 'mock');
    let summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.readiness.requirements.filter((r) => !r.ok).map((r) => r.key)).toEqual(['permit_verified', 'package']);
    await expect(pkg.buildCrematoryPackage(ctx(), '1042', 'mock')).rejects.toMatchObject({ status: 422 });
    // Confirming it rebuilds the package automatically.
    await pkg.confirmPermit(ctx(), '1042', shown(newPermit.id), 'mock');
    expect(docsOf('1042', 'cremation_form.crematory_package')).toHaveLength(2);
    expect((await pkg.buildCrematoryPackage(ctx(), '1042', 'mock')).outcome).toBe('unchanged');

    // A different confirmed date: rebuilt automatically under the new name.
    await pkg.confirmReadyDate(ctx(), '1042', '11/09/2026', 'mock');
    summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.package).toMatchObject({ current: true, fileName: 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-09-2026.pdf' });
    expect((await pkg.buildCrematoryPackage(ctx(), '1042', 'mock')).outcome).toBe('unchanged');

    const versions = docsOf('1042', 'cremation_form.crematory_package');
    expect(versions.map((d) => [d.version, d.status, d.fileName])).toEqual([
      [1, 'superseded', 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf'],
      [2, 'superseded', 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf'],
      [3, 'active', 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-09-2026.pdf'],
    ]);
    // Older versions keep their files.
    for (const v of versions) expect(createHash('sha256').update(blobs.get(v.storageKey)!.buffer).digest('hex')).toBe(v.checksumSha256);
  });

  it('if the Expected Pickup moves after the date was confirmed, the date must be reviewed', async () => {
    await readyCase('1042');
    await pkg.buildCrematoryPackage(ctx(), '1042', 'mock');
    appointmentFixtures.find((a) => a.id === 'cremains-pickup-1042')!.startAt = '2026-11-10T05:00:00.000Z';
    const summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.readiness.requirements.find((r) => r.key === 'ready_date')).toMatchObject({ ok: false, detail: expect.stringContaining('Expected Pickup changed') });
  });

  it('a permit confirmation is for one file: confirming a replaced permit is refused', async () => {
    await uploadAs('1042', 'State Permit.pdf', 'cremation_form.state_permit', await pdf('PERMIT', 1), 'permit-old');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await pkg.addPermit(ctx(), '1042', { fileName: 'State Permit 2.pdf', mimeType: 'application/pdf', bytes: await pdf('PERMIT-B', 1) }, { replacesDocumentId: 'permit-old', mayReplace: true }, 'mock');
    await expect(pkg.confirmPermit(ctx(), '1042', shown('permit-old'), 'mock')).rejects.toMatchObject({ status: 409 });
  });
});

describe('sending — one Outlook email, one PDF per decedent', () => {
  type Call = [string, RequestInit | undefined];
  function fakeGraph(options: { failAttachment?: boolean; failSend?: number } = {}) {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith('/me/messages') && init?.method === 'POST') return new Response(JSON.stringify({ id: 'draft-1', internetMessageId: '<msg-1@outlook>' }), { status: 201 });
      if (url.endsWith('/attachments')) return options.failAttachment ? new Response(JSON.stringify({ error: { code: 'ErrorQuotaExceeded' } }), { status: 507 }) : new Response('{}', { status: 201 });
      if (url.endsWith('/send')) return options.failSend ? new Response(JSON.stringify({ error: { code: 'X' } }), { status: options.failSend }) : new Response(null, { status: 202 });
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error(`unexpected ${url}`);
    }));
    return calls;
  }
  const request = (over: Partial<Parameters<typeof sendCrematoryPackages>[1]> = {}) => ({
    caseIds: ['1042', '1044'],
    to: ['intake@crematory.example'],
    cc: [],
    subject: 'Manors Cremation — 2 Cases for Crematory',
    message: 'Hello',
    submissionId: 'sub-0000-0001',
    confirmResend: false,
    reviewFingerprint: '',
    acknowledged: true,
    ...over,
  });
  /** As the window does: the server's final review first, then Confirm & Send with its fingerprint. */
  const fingerprintFor = (caseIds: string[]) => reviewCrematorySend(ORG, caseIds, 'mock').then((r) => r.fingerprint).catch(() => 'v1:not-reviewable');
  const send = async (over: Partial<Parameters<typeof sendCrematoryPackages>[1]> = {}, who = ctx()) => {
    const body = request(over);
    return sendCrematoryPackages(who, { ...body, reviewFingerprint: over.reviewFingerprint ?? (await fingerprintFor(body.caseIds)) }, 'mock');
  };
  async function twoReadyCases() {
    await readyCase('1042');
    await readyCase('1044');
    await pkg.buildCrematoryPackage(ctx(), '1042', 'mock');
    await pkg.buildCrematoryPackage(ctx(), '1044', 'mock');
    connectMockCrematoryMailbox(ORG, 'office@funeralhome.example', 'access-token');
  }

  it('attaches each case\'s package — and only those — to ONE email, and records it on each case', async () => {
    await twoReadyCases();
    const calls = fakeGraph();
    const result = await send({}, ctx('staff-lee'));
    expect(result).toMatchObject({ status: 'submitted', duplicate: false, mailbox: 'office@funeralhome.example', internetMessageId: '<msg-1@outlook>' });

    expect(calls.filter(([url]) => url.endsWith('/me/messages'))).toHaveLength(1);
    const attached = calls.filter(([url]) => url.endsWith('/attachments')).map(([, init]) => JSON.parse(String(init!.body)));
    expect(attached.map((a) => a.name)).toEqual(['REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf', 'SALAS RUEDA_ESTELA_CREMATORY_PACKAGE_11-06-2026.pdf']);
    expect(attached.map((a) => [a['@odata.type'], a.contentType])).toEqual([['#microsoft.graph.fileAttachment', 'application/pdf'], ['#microsoft.graph.fileAttachment', 'application/pdf']]);
    for (const [i, caseId] of ['1042', '1044'].entries()) {
      const stored = blobs.get(docsOf(caseId, 'cremation_form.crematory_package')[0].storageKey)!.buffer;
      expect(Buffer.from(attached[i].contentBytes, 'base64').equals(stored)).toBe(true);
    }

    for (const caseId of ['1042', '1044']) {
      const record = caseFixtures[index(caseId)].crematory!.lastSubmission!;
      expect(record).toMatchObject({ status: 'submitted', submissionId: 'sub-0000-0001', to: ['intake@crematory.example'], mailbox: 'office@funeralhome.example', internetMessageId: '<msg-1@outlook>', packageVersion: 1, by: 'staff-lee' });
      expect(caseFixtures[index(caseId)].crematory!.pendingSubmission).toBeNull();
      expect(eventsOf(caseId, 'crematory.package_submitted')[0].description).toContain('submitted to Outlook, delivery not confirmed');
    }
  });

  it('each case is sent ONCE: the same request reports the first send, and nothing — not even an override — sends it again', async () => {
    await twoReadyCases();
    const calls = fakeGraph();
    await send();
    const again = await send();
    expect(again.duplicate).toBe(true);

    await expect(send({ submissionId: 'sub-0000-0002' })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Each case is sent only once') });
    await expect(send({ submissionId: 'sub-0000-0003', confirmResend: true })).rejects.toMatchObject({ status: 409 });
    // A sent case's date, name, permit and package are never changed again (2026-10) — and it stays sent.
    await expect(pkg.confirmReadyDate(ctx(), '1042', '11/09/2026', 'mock')).rejects.toMatchObject({ status: 409 });
    await expect(pkg.confirmPackageName(ctx(), '1042', { first: 'Rick', last: 'Reynolds' }, 'mock')).rejects.toMatchObject({ status: 409 });
    await expect(pkg.buildCrematoryPackage(ctx(), '1042', 'mock')).rejects.toMatchObject({ status: 409 });
    await expect(pkg.confirmPermit(ctx(), '1042', shown('permit-1042'), 'mock')).rejects.toMatchObject({ status: 409 });
    expect(docsOf('1042', 'cremation_form.crematory_package').map((d) => [d.version, d.status])).toEqual([[1, 'active']]);
    await expect(send({ caseIds: ['1042'], submissionId: 'sub-0000-0007', confirmResend: true })).rejects.toMatchObject({ status: 409 });
    expect(calls.filter(([url]) => url.endsWith('/send'))).toHaveLength(1);
    expect((await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock')).readiness.readyToSend).toBe(false);
  });

  it('a case that is not ready blocks the whole email — nothing is sent', async () => {
    await twoReadyCases();
    caseFixtures[index('1044')] = { ...caseFixtures[index('1044')], checklistState: { '2:0': true } };
    const calls = fakeGraph();
    await expect(send()).rejects.toMatchObject({ status: 422, message: expect.stringContaining('B2026-902') });
    expect(calls).toHaveLength(0);
  });

  it('no connected mailbox, or no recipient: nothing is sent', async () => {
    await readyCase('1042');
    await pkg.buildCrematoryPackage(ctx(), '1042', 'mock');
    const calls = fakeGraph();
    await expect(send({ caseIds: ['1042'] })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('No Outlook mailbox') });
    connectMockCrematoryMailbox(ORG, 'office@funeralhome.example', 'access-token');
    await expect(send({ caseIds: ['1042'], to: [] })).rejects.toMatchObject({ status: 400 });
    await expect(send({ caseIds: ['1042'], to: ['not-an-email'] })).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
  });

  it('a failure before sending is recorded as not sent and can be retried; a failing send call is recorded as uncertain', async () => {
    await twoReadyCases();
    fakeGraph({ failAttachment: true });
    await expect(send()).rejects.toMatchObject({ status: 502, message: expect.stringContaining('Nothing was sent') });
    expect(caseFixtures[index('1042')].crematory!.lastSubmission).toMatchObject({ status: 'failed' });
    expect(eventsOf('1042', 'crematory.package_send_failed')).toHaveLength(1);

    // A failing send call is recorded as uncertain ("may have been sent").
    fakeGraph({ failSend: 503 });
    await expect(send({ submissionId: 'sub-0000-0005' })).rejects.toMatchObject({ message: expect.stringContaining('may still have been sent') });
    expect(caseFixtures[index('1042')].crematory!.lastSubmission).toMatchObject({ status: 'uncertain' });
    // It is retried only after staff confirm, from Sent Items, that it did not go out.
    fakeGraph();
    await expect(send({ submissionId: 'sub-0000-0006' })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Check Sent Items') });
    await expect(send({ submissionId: 'sub-0000-0004', confirmResend: true })).resolves.toMatchObject({ status: 'submitted' });
  });

  it('two decedents with the same name and date never share an attachment name', async () => {
    caseFixtures[index('1044')] = { ...caseFixtures[index('1044')], decedentName: 'RICHARD REYNOLDS' };
    await twoReadyCases();
    await pkg.confirmPackageName(ctx(), '1044', { first: 'Richard', last: 'Reynolds' }, 'mock');
    await pkg.buildCrematoryPackage(ctx(), '1044', 'mock');
    const calls = fakeGraph();
    await send();
    const names = calls.filter(([url]) => url.endsWith('/attachments')).map(([, init]) => JSON.parse(String(init!.body)).name);
    expect(names).toEqual(['REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026_B2026-901.pdf', 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026_B2026-902.pdf']);
  });

  it('a package built before the 2026-10 naming is still current — not rebuilt — and is attached, unchanged, under the new name', async () => {
    await twoReadyCases();
    // As built before the change: stored (and recorded) as Reynolds_Richard_11-06-2026.pdf.
    const saved = docsOf('1042', 'cremation_form.crematory_package')[0];
    const legacy = 'Reynolds_Richard_11-06-2026.pdf';
    caseDocumentFixtures[caseDocumentFixtures.findIndex((d) => d.id === saved.id)] = { ...saved, fileName: legacy };
    const c = caseFixtures[index('1042')];
    caseFixtures[index('1042')] = { ...c, crematory: { ...c.crematory!, lastBuild: { ...c.crematory!.lastBuild!, fileName: legacy } } };

    const summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.package).toMatchObject({ fileName: legacy, current: true });
    expect(summary.readiness.readyToSend).toBe(true);
    expect((await pkg.buildCrematoryPackage(ctx(), '1042', 'mock')).outcome).toBe('unchanged');
    expect(docsOf('1042', 'cremation_form.crematory_package')).toHaveLength(1);

    const calls = fakeGraph();
    await send();
    const attached = calls.filter(([url]) => url.endsWith('/attachments')).map(([, init]) => JSON.parse(String(init!.body)));
    expect(attached[0].name).toBe('REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf');
    expect(Buffer.from(attached[0].contentBytes, 'base64').equals(blobs.get(saved.storageKey)!.buffer)).toBe(true);
    expect(docsOf('1042', 'cremation_form.crematory_package')[0].fileName).toBe(legacy);
    expect(caseFixtures[index('1042')].crematory!.lastSubmission!).toMatchObject({ status: 'submitted', attachmentName: 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf' });
    expect(eventsOf('1042', 'crematory.package_submitted')[0].description).toContain('(REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf)');
  });

  it('a package whose stored file no longer matches its checksum is never sent', async () => {
    await twoReadyCases();
    const saved = docsOf('1042', 'cremation_form.crematory_package')[0];
    blobs.set(saved.storageKey, { buffer: Buffer.from('tampered'), contentType: 'application/pdf' });
    const calls = fakeGraph();
    await expect(send()).rejects.toMatchObject({ status: 503 });
    expect(calls.some(([url]) => url.endsWith('/send'))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // The final review and Confirm & Send (2026-10)
  // -------------------------------------------------------------------------
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');

  it('the review is the exact email, read-only: each package as stored, its permit verification, the default subject — and a fingerprint', async () => {
    await twoReadyCases();
    const before = JSON.stringify([caseFixtures[index('1042')], caseFixtures[index('1044')]]);
    const counts = [caseDocumentFixtures.length, activityEventFixtures.length];
    const review = await reviewCrematorySend(ORG, ['1042', '1044'], 'mock');
    expect(review.fingerprint).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(review.cases.map((c) => [c.caseNumber, c.attachmentName, c.expectedReadyDate, c.readyDateFrom, c.packageVersion])).toEqual([
      ['B2026-901', 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf', '11/06/2026', 'staff', 1],
      ['B2026-902', 'SALAS RUEDA_ESTELA_CREMATORY_PACKAGE_11-06-2026.pdf', '11/06/2026', 'staff', 1],
    ]);
    expect(review.cases[0].packageChecksumSha256).toBe(docsOf('1042', 'cremation_form.crematory_package')[0].checksumSha256);
    expect(review.cases[0].permit).toMatchObject({ documentId: 'permit-1042', fileName: 'State Permit.pdf', verifiedBy: 'staff-dana' });
    expect(review.subject).toBe('Manors Cremation — 2 Cases for Crematory — Expected 11/06/2026');
    expect(review.mailbox).toBe('office@funeralhome.example');
    // Nothing prepared, changed or recorded.
    expect(JSON.stringify([caseFixtures[index('1042')], caseFixtures[index('1044')]])).toBe(before);
    expect([caseDocumentFixtures.length, activityEventFixtures.length]).toEqual(counts);
    expect((await reviewCrematorySend(ORG, ['1042', '1044'], 'mock')).fingerprint).toBe(review.fingerprint);
  });

  const acknowledgments = () => activityEventFixtures.slice(lengths.activity).filter((e) => e.eventType === 'crematory.send_confirmed');

  it('Confirm & Send writes ONE acknowledgment for the whole email — who, when, the exact recipients, subject and every case\'s attachment — before anything is sent, linked to each case', async () => {
    await twoReadyCases();
    fakeGraph();
    const review = await reviewCrematorySend(ORG, ['1042', '1044'], 'mock');
    // Staff edited the CC, subject and message during the review: exactly those are sent and recorded.
    await sendCrematoryPackages(ctx('staff-lee'), request({ reviewFingerprint: review.fingerprint, cc: ['office@funeralhome.example'], subject: 'Edited subject', message: 'Edited message' }), 'mock');
    const checksums = ['1042', '1044'].map((id) => docsOf(id, 'cremation_form.crematory_package')[0].checksumSha256);
    const acks = acknowledgments();
    expect(acks).toHaveLength(1);
    const [ack] = acks;
    expect(ack).toMatchObject({ caseId: null, resourceType: 'crematorySubmission', resourceId: 'sub-0000-0001', actorIdentityId: 'staff-lee' });
    expect(ack.description).toBe('Final review confirmed (Confirm & Send): 2 attachments (B2026-901, B2026-902) to intake@crematory.example — "Edited subject"');
    const record = JSON.parse(ack.newValue!);
    expect(record).toMatchObject({
      submissionId: 'sub-0000-0001',
      reviewFingerprint: review.fingerprint,
      acknowledgedBy: 'staff-lee',
      acknowledgedAt: expect.any(String),
      to: ['intake@crematory.example'],
      cc: ['office@funeralhome.example'],
      subject: 'Edited subject',
      messageSha256: sha('Edited message'),
      caseIds: ['1042', '1044'],
      attachments: [
        { caseId: '1042', caseNumber: 'B2026-901', attachmentName: 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf', packageVersion: 1, packageChecksumSha256: checksums[0] },
        { caseId: '1044', caseNumber: 'B2026-902', attachmentName: 'SALAS RUEDA_ESTELA_CREMATORY_PACKAGE_11-06-2026.pdf', packageVersion: 1, packageChecksumSha256: checksums[1] },
      ],
    });
    // Recorded before anything was submitted; each case links to it.
    const all = activityEventFixtures.slice(lengths.activity);
    expect(all.indexOf(ack)).toBeLessThan(all.findIndex((e) => e.eventType === 'crematory.package_submitted'));
    for (const [i, caseId] of ['1042', '1044'].entries()) {
      expect(caseFixtures[index(caseId)].crematory!.lastSubmission).toMatchObject({
        status: 'submitted',
        acknowledgmentId: record.acknowledgmentId,
        packageChecksumSha256: checksums[i],
        subject: 'Edited subject',
        reviewFingerprint: review.fingerprint,
        cc: ['office@funeralhome.example'],
      });
      expect(JSON.parse(eventsOf(caseId, 'crematory.package_submitted')[0].newValue!)).toMatchObject({ acknowledgmentId: record.acknowledgmentId, acknowledgedBy: 'staff-lee', packageChecksumSha256: checksums[i] });
    }
  });

  it('if the acknowledgment cannot be recorded, nothing is sent and no case is left locked or marked', async () => {
    await twoReadyCases();
    const calls = fakeGraph();
    const review = await reviewCrematorySend(ORG, ['1042', '1044'], 'mock');
    const push = vi.spyOn(activityEventFixtures, 'push').mockImplementationOnce(() => {
      throw new Error('activity storage unavailable');
    });
    await expect(sendCrematoryPackages(ctx(), request({ reviewFingerprint: review.fingerprint }), 'mock')).rejects.toMatchObject({ status: 503, message: expect.stringContaining('Your confirmation could not be recorded') });
    push.mockRestore();
    expect(calls).toHaveLength(0);
    expect(acknowledgments()).toHaveLength(0);
    for (const id of ['1042', '1044']) {
      expect(caseFixtures[index(id)].crematory!.pendingSubmission ?? null).toBeNull();
      expect(caseFixtures[index(id)].crematory!.lastSubmission ?? null).toBeNull();
    }
    // Nothing was spent: the same review sends once the record can be written.
    await expect(sendCrematoryPackages(ctx(), request({ reviewFingerprint: review.fingerprint }), 'mock')).resolves.toMatchObject({ status: 'submitted' });
    expect(acknowledgments()).toHaveLength(1);
  });

  it('a later case failing its last check (its stored PDF unreadable) stops the whole email: no acknowledgment, nothing sent, the earlier case unlocked', async () => {
    await twoReadyCases();
    const calls = fakeGraph();
    const review = await reviewCrematorySend(ORG, ['1042', '1044'], 'mock');
    blobs.set(docsOf('1044', 'cremation_form.crematory_package')[0].storageKey, { buffer: Buffer.from('tampered'), contentType: 'application/pdf' });
    await expect(sendCrematoryPackages(ctx(), request({ reviewFingerprint: review.fingerprint }), 'mock')).rejects.toMatchObject({ status: 503, message: expect.stringContaining('B2026-902') });
    expect(calls).toHaveLength(0);
    expect(acknowledgments()).toHaveLength(0);
    for (const id of ['1042', '1044']) expect(caseFixtures[index(id)].crematory!.pendingSubmission ?? null).toBeNull();
  });

  it('reviewed is not sent: when Outlook fails after the acknowledgment, each case is recorded as failed (or uncertain), still not sent, and can be sent after a fresh confirmation', async () => {
    await twoReadyCases();
    fakeGraph({ failAttachment: true });
    await expect(send()).rejects.toMatchObject({ status: 502 });
    const [ack] = acknowledgments();
    const { acknowledgmentId } = JSON.parse(ack.newValue!);
    for (const id of ['1042', '1044']) {
      expect(caseFixtures[index(id)].crematory!.lastSubmission).toMatchObject({ status: 'failed', acknowledgmentId });
      expect(JSON.parse(eventsOf(id, 'crematory.package_send_failed')[0].newValue!)).toMatchObject({ acknowledgmentId });
      const summary = await pkg.getCrematoryCaseSummary(ORG, id, true, 'mock');
      expect(summary.readiness.requirements.find((r) => r.key === 'not_sent')!.ok).toBe(true);
    }
    fakeGraph({ failSend: 503 });
    await expect(send({ submissionId: 'sub-0000-0010' })).rejects.toMatchObject({ message: expect.stringContaining('may still have been sent') });
    expect(caseFixtures[index('1042')].crematory!.lastSubmission).toMatchObject({ status: 'uncertain' });
    fakeGraph();
    await expect(send({ submissionId: 'sub-0000-0011', confirmResend: true })).resolves.toMatchObject({ status: 'submitted' });
    // Three confirmations, three records; only the last is a send.
    expect(acknowledgments().map((e) => e.resourceId)).toEqual(['sub-0000-0001', 'sub-0000-0010', 'sub-0000-0011']);
    expect(caseFixtures[index('1044')].crematory!.lastSubmission).toMatchObject({ status: 'submitted', submissionId: 'sub-0000-0011' });
  });

  it('nothing is sent without the review, without the acknowledgment, for cases other than those reviewed, or once anything reviewed changed', async () => {
    await twoReadyCases();
    const calls = fakeGraph();
    const review = await reviewCrematorySend(ORG, ['1042', '1044'], 'mock');
    // A window opened before this update carries no fingerprint.
    await expect(sendCrematoryPackages(ctx(), request({ reviewFingerprint: '' }), 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Send to Crematory was updated') });
    await expect(sendCrematoryPackages(ctx(), request({ reviewFingerprint: review.fingerprint, acknowledged: false }), 'mock')).rejects.toMatchObject({ status: 400 });
    await expect(sendCrematoryPackages(ctx(), request({ caseIds: ['1042'], reviewFingerprint: review.fingerprint }), 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('changed since you reviewed') });
    // A change after the review (a corrected date rebuilds the package): the reviewed email is stale.
    await pkg.confirmReadyDate(ctx(), '1042', '11/09/2026', 'mock');
    await expect(sendCrematoryPackages(ctx(), request({ reviewFingerprint: review.fingerprint }), 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('changed since you reviewed') });
    expect(calls).toHaveLength(0);
    expect(acknowledgments()).toHaveLength(0);
    expect(caseFixtures[index('1042')].crematory!.pendingSubmission ?? null).toBeNull();
    // Reviewed again, it sends the new package.
    await expect(send()).resolves.toMatchObject({ status: 'submitted', attachments: [expect.objectContaining({ attachmentName: 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-09-2026.pdf', packageVersion: 2 }), expect.anything()] });
  });

  it('never while a case is being prepared: the review and the send both refuse, nothing is sent and no case stays locked', async () => {
    await twoReadyCases();
    const calls = fakeGraph();
    const review = await reviewCrematorySend(ORG, ['1042', '1044'], 'mock');
    const c = caseFixtures[index('1044')];
    caseFixtures[index('1044')] = { ...c, crematory: { ...c.crematory!, preparing: { token: 'other-server', until: new Date(Date.now() + 60_000).toISOString() } } };
    await expect(reviewCrematorySend(ORG, ['1042', '1044'], 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('still being prepared') });
    await expect(sendCrematoryPackages(ctx(), request({ reviewFingerprint: review.fingerprint }), 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('still being prepared') });
    expect(calls).toHaveLength(0);
    for (const id of ['1042', '1044']) expect(caseFixtures[index(id)].crematory!.pendingSubmission ?? null).toBeNull();
  });

  it('the review refuses a case that is not ready or already sent', async () => {
    await twoReadyCases();
    caseFixtures[index('1044')] = { ...caseFixtures[index('1044')], checklistState: { '2:0': true } };
    await expect(reviewCrematorySend(ORG, ['1042', '1044'], 'mock')).rejects.toMatchObject({ status: 422, message: expect.stringContaining('B2026-902') });
    fakeGraph();
    await send({ caseIds: ['1042'] });
    await expect(reviewCrematorySend(ORG, ['1042'], 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Each case is sent only once') });
  });

  describe('Workflow 3 after a send, and never sending twice (2026-10)', () => {
    const PERMIT_SENT = '3:0';
    const RELEASE_SENT = '3:1';
    const sendsOf = (calls: Call[]) => calls.filter(([url]) => url.endsWith('/send')).length;

    it('a successful send checks "Permit sent to crematory" and "Authorization of release sent to crematory" on every sent case, attributed to the sender — and they stay checked', async () => {
      await twoReadyCases();
      fakeGraph();
      const result = await send({}, ctx('staff-lee'));
      expect(result.checklist).toEqual({ failed: [] });

      for (const caseId of ['1042', '1044']) {
        // Read back as a fresh load of the case would (a refresh / reopen).
        const stored = caseFixtures[index(caseId)];
        expect(stored.checklistState).toMatchObject({ [PERMIT_SENT]: true, [RELEASE_SENT]: true });
        const sentAt = stored.crematory!.lastSubmission!.at;
        for (const key of [PERMIT_SENT, RELEASE_SENT]) {
          expect(stored.checklistCompletions![key]).toMatchObject({
            done: true,
            method: 'automatic',
            source: 'workflow_event',
            eventType: 'crematory.package_submitted',
            eventId: 'sub-0000-0001',
            actorId: 'staff-lee',
          });
          expect(Date.parse(stored.checklistCompletions![key].at)).toBeGreaterThanOrEqual(Date.parse(sentAt));
        }
        const events = eventsOf(caseId, 'case.checklist.completed_automatically');
        expect(events).toHaveLength(2);
        expect(events.every((e) => e.actorIdentityId === 'staff-lee')).toBe(true);
        expect(crematorySendState(stored)).toEqual({ kind: 'sent', at: sentAt });
        // Earlier stages and the case's other ticks are untouched; the stage never moves back.
        expect(stored.checklistState).toMatchObject({ '2:0': true, '2:1': true, '2:2': true });
        expect(stored.rawStage).toBeGreaterThanOrEqual(originals.get(caseId)!.rawStage);
      }
    });

    it('a failed send, or one Outlook left unclear, checks nothing; only the confirmed send that follows does', async () => {
      await twoReadyCases();
      fakeGraph({ failAttachment: true });
      await expect(send()).rejects.toMatchObject({ status: 502 });
      expect(caseFixtures[index('1042')].checklistState[PERMIT_SENT]).toBeUndefined();
      expect(caseFixtures[index('1042')].checklistState[RELEASE_SENT]).toBeUndefined();

      fakeGraph({ failSend: 503 });
      await expect(send({ submissionId: 'sub-0000-0005' })).rejects.toMatchObject({ message: expect.stringContaining('may still have been sent') });
      expect(caseFixtures[index('1042')].crematory!.lastSubmission!.status).toBe('uncertain');
      expect(caseFixtures[index('1042')].checklistState[PERMIT_SENT]).toBeUndefined();
      expect(eventsOf('1042', 'case.checklist.completed_automatically')).toHaveLength(0);

      // Never resent automatically: only after staff confirm from Sent Items.
      const calls = fakeGraph();
      await expect(send({ submissionId: 'sub-0000-0006' })).rejects.toMatchObject({ status: 409 });
      expect(sendsOf(calls)).toBe(0);
      await send({ submissionId: 'sub-0000-0007', confirmResend: true });
      expect(caseFixtures[index('1042')].checklistState).toMatchObject({ [PERMIT_SENT]: true, [RELEASE_SENT]: true });
    });

    it('while a send is in progress the case is "being sent": a second request — another staff member, or the same request again (a double click) — is refused and sends nothing', async () => {
      await twoReadyCases();
      const calls = fakeGraph();
      const startedAt = new Date().toISOString();
      caseFixtures[index('1042')] = {
        ...caseFixtures[index('1042')],
        crematory: { ...caseFixtures[index('1042')].crematory, pendingSubmission: { submissionId: 'sub-0000-0001', startedAt, startedBy: 'staff-lee', acknowledgmentId: 'ack-1' } },
      };
      expect(crematorySendState(caseFixtures[index('1042')])).toEqual({ kind: 'sending' });
      await expect(send({ submissionId: 'sub-0000-0001' })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('being sent right now') });
      await expect(send({ submissionId: 'sub-0000-0002' }, ctx('staff-kim'))).rejects.toMatchObject({ status: 409, message: expect.stringContaining('being sent right now') });
      expect(sendsOf(calls)).toBe(0);
      expect(caseFixtures[index('1042')].checklistState[PERMIT_SENT]).toBeUndefined();
    });

    it('two staff members sending at the same moment: exactly one email goes out; the other is refused', async () => {
      await twoReadyCases();
      const calls = fakeGraph();
      const outcomes = await Promise.allSettled([send({ submissionId: 'sub-0000-00a1' }, ctx('staff-lee')), send({ submissionId: 'sub-0000-00b2' }, ctx('staff-kim'))]);
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((o) => o.status === 'rejected').map((o) => (o as PromiseRejectedResult).reason.status)).toEqual([409]);
      expect(sendsOf(calls)).toBe(1);
      expect(calls.filter(([url]) => url.endsWith('/me/messages'))).toHaveLength(1);
    });

    it('the same request twice at the same moment (a double click) sends ONE email', async () => {
      await twoReadyCases();
      const calls = fakeGraph();
      const fingerprint = await fingerprintFor(['1042', '1044']);
      const outcomes = await Promise.allSettled([send({ reviewFingerprint: fingerprint }), send({ reviewFingerprint: fingerprint })]);
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(sendsOf(calls)).toBe(1);
    });

    it('once sent, the case can never be sent again — not after unchecking Workflow 3, not with an override; unchecking never re-enables it', async () => {
      await twoReadyCases();
      const calls = fakeGraph();
      await send();
      // Staff uncheck both items afterwards.
      caseFixtures[index('1042')] = { ...caseFixtures[index('1042')], checklistState: { ...caseFixtures[index('1042')].checklistState, [PERMIT_SENT]: false, [RELEASE_SENT]: false } };
      const summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
      expect(summary.readiness.readyToSend).toBe(false);
      expect(summary.readiness.requirements.find((r) => r.key === 'not_sent')).toMatchObject({ ok: false });
      expect(crematorySendState(caseFixtures[index('1042')]).kind).toBe('sent');
      await expect(send({ caseIds: ['1042'], submissionId: 'sub-0000-0009' })).rejects.toMatchObject({ status: 409 });
      await expect(send({ caseIds: ['1042'], submissionId: 'sub-0000-0010', confirmResend: true })).rejects.toMatchObject({ status: 409 });
      expect(sendsOf(calls)).toBe(1);
    });

    it('a case sent before this change (sent, Workflow 3 never checked) stays protected: no resend, and its checklist is not rewritten by a refused attempt', async () => {
      await twoReadyCases();
      const calls = fakeGraph();
      const before = caseFixtures[index('1042')];
      caseFixtures[index('1042')] = {
        ...before,
        crematory: { ...before.crematory, pendingSubmission: null, lastSubmission: { ...(before.crematory?.lastSubmission ?? {}), submissionId: 'sub-legacy-0001', status: 'submitted', at: '2026-10-20T15:00:00.000Z', by: 'staff-old' } as never },
      };
      await expect(send({ caseIds: ['1042'], submissionId: 'sub-0000-0011' })).rejects.toMatchObject({ status: 409 });
      expect(sendsOf(calls)).toBe(0);
      expect(caseFixtures[index('1042')].checklistState[PERMIT_SENT]).toBeUndefined();
    });

    it('checking the items never sends: completing the checklist (including a staff retry) calls Outlook zero times', async () => {
      await twoReadyCases();
      fakeGraph();
      sentChecklistFault.fail = true;
      await send({ caseIds: ['1042'] });
      sentChecklistFault.fail = false;
      const calls = fakeGraph();
      await expect(retryCrematorySentChecklist(ctx(), '1042', 'mock')).resolves.toBe('completed');
      await expect(retryCrematorySentChecklist(ctx(), '1042', 'mock')).resolves.toBe('unchanged');
      expect(calls).toHaveLength(0);
    });

    it('if the checklist cannot be saved after the send: the send stays recorded, the failure is reported, nothing is resent — and a retry completes it', async () => {
      await twoReadyCases();
      const calls = fakeGraph();
      sentChecklistFault.fail = true;
      const result = await send();
      expect(result.status).toBe('submitted');
      expect(result.checklist.failed.map((c) => c.caseNumber)).toEqual(['B2026-901', 'B2026-902']);
      expect(caseFixtures[index('1042')].crematory!.lastSubmission!.status).toBe('submitted');
      expect(caseFixtures[index('1042')].checklistState[PERMIT_SENT]).toBeUndefined();
      expect(sendsOf(calls)).toBe(1);

      // The same request again (the window retrying) reports the first send, sends nothing, and completes the checklist.
      sentChecklistFault.fail = false;
      const again = await send();
      expect(again).toMatchObject({ duplicate: true, checklist: { failed: [] } });
      expect(sendsOf(calls)).toBe(1);
      for (const caseId of ['1042', '1044']) expect(caseFixtures[index(caseId)].checklistState).toMatchObject({ [PERMIT_SENT]: true, [RELEASE_SENT]: true });
    });

    it('a staff reopen made before the send is superseded by the send; a staff tick is kept as it was', async () => {
      await twoReadyCases();
      fakeGraph();
      const earlier = '2026-10-01T12:00:00.000Z';
      caseFixtures[index('1042')] = {
        ...caseFixtures[index('1042')],
        checklistState: { ...caseFixtures[index('1042')].checklistState, [PERMIT_SENT]: false, [RELEASE_SENT]: true },
        checklistCompletions: {
          [PERMIT_SENT]: { done: false, method: 'manual', source: 'staff_confirmation', eventType: 'staff.checklist_toggle', eventId: null, at: earlier, actorId: 'staff-dana' },
          [RELEASE_SENT]: { done: true, method: 'manual', source: 'staff_confirmation', eventType: 'staff.checklist_toggle', eventId: null, at: earlier, actorId: 'staff-dana' },
        },
      };
      // The checked "Permit sent" step would have flagged a possible earlier send; here it is unchecked, so the case is ready.
      await send({ caseIds: ['1042'], reviewFingerprint: await fingerprintFor(['1042']) });
      const stored = caseFixtures[index('1042')];
      expect(stored.checklistState).toMatchObject({ [PERMIT_SENT]: true, [RELEASE_SENT]: true });
      expect(stored.checklistCompletions![PERMIT_SENT]).toMatchObject({ method: 'automatic', done: true });
      expect(stored.checklistCompletions![RELEASE_SENT]).toEqual({ done: true, method: 'manual', source: 'staff_confirmation', eventType: 'staff.checklist_toggle', eventId: null, at: earlier, actorId: 'staff-dana' });
    });

    it('archived: a sent case archived since is never written, and the retry is refused', async () => {
      await twoReadyCases();
      fakeGraph();
      sentChecklistFault.fail = true;
      await send({ caseIds: ['1042'] });
      sentChecklistFault.fail = false;
      caseFixtures[index('1042')] = { ...caseFixtures[index('1042')], isDeleted: true };
      await expect(retryCrematorySentChecklist(ctx(), '1042', 'mock')).rejects.toMatchObject({ status: 409 });
      expect(await completeCrematorySentChecklist(ctx(), '1042', 'sub-0000-0001', 'mock')).toBe('unchanged');
      expect(caseFixtures[index('1042')].checklistState[PERMIT_SENT]).toBeUndefined();
    });

    it('a case SOLIS has not sent is never checked from a send — not by a retry, not by a send id that is not its own', async () => {
      await twoReadyCases();
      await expect(retryCrematorySentChecklist(ctx(), '1042', 'mock')).rejects.toMatchObject({ status: 409 });
      expect(await completeCrematorySentChecklist(ctx(), '1042', 'sub-not-this-case', 'mock')).toBe('unchanged');
      expect(caseFixtures[index('1042')].checklistState[PERMIT_SENT]).toBeUndefined();
    });

    it('another organization\'s case is never checked', async () => {
      await twoReadyCases();
      fakeGraph();
      sentChecklistFault.fail = true;
      await send({ caseIds: ['1042'] });
      sentChecklistFault.fail = false;
      const otherOrg = { ...ctx(), organizationId: 'evergreen-memorial-group' };
      await expect(retryCrematorySentChecklist(otherOrg, '1042', 'mock')).rejects.toMatchObject({ status: 404 });
      expect(await completeCrematorySentChecklist(otherOrg, '1042', 'sub-0000-0001', 'mock')).toBe('not_applicable');
      expect(caseFixtures[index('1042')].checklistState[PERMIT_SENT]).toBeUndefined();
    });
  });
});

describe('the Cases page list', () => {
  it('lists open cremation cases with what each still needs, ready ones first', async () => {
    await readyCase('1044');
    await pkg.buildCrematoryPackage(ctx(), '1044', 'mock');
    const list = await pkg.listCrematoryCandidates(ORG, true, 'mock');
    const mine = list.filter((c) => c.caseId === '1042' || c.caseId === '1044');
    expect(mine[0]).toMatchObject({ caseId: '1044', readiness: { readyToSend: true }, package: { fileName: 'SALAS RUEDA_ESTELA_CREMATORY_PACKAGE_11-06-2026.pdf' } });
    expect(mine[1]).toMatchObject({ caseId: '1042', readiness: { readyToSend: false } });
    expect(list.every((c) => caseFixtures.find((x) => x.id === c.caseId)?.caseType === 'cremation')).toBe(true);
  });
});

describe('the name and expected ready date, recorded automatically from reliable sources (2026-10)', () => {
  const PACKAGE = 'cremation_form.crematory_package';
  let forms = 0;
  beforeEach(async () => {
    forms = (await import('../__mocks__/externalFormFixtures')).externalFormSubmissionFixtures.length;
  });
  afterEach(async () => {
    (await import('../__mocks__/externalFormFixtures')).externalFormSubmissionFixtures.length = forms;
  });
  /** A fictional intake form with its own first / middle / last name boxes. */
  async function intakeForm(caseId: string, id: string, name: { first: string; middle?: string; last: string }) {
    const { externalFormSubmissionFixtures } = await import('../__mocks__/externalFormFixtures');
    externalFormSubmissionFixtures.push({
      id, organizationId: ORG, provider: 'jotform', externalFormId: '262664842044055', externalSubmissionId: null, caseFormLinkId: null,
      createdCaseId: caseId, status: 'matched', receivedAt: '2026-10-20T10:00:00.000Z',
      mappedFields: JSON.stringify({ decedentFirstName: name.first, decedentMiddleName: name.middle ?? '', decedentLastName: name.last }),
    } as never);
  }
  /** Everything but the name and date: Arrangement Form, a confirmed permit, workflow 2. */
  async function documentsReady(caseId: string) {
    await uploadAs(caseId, 'Arrangement Forms.pdf', 'external_form.arrangement_forms', await pdf(`ARRANGEMENT-${caseId}`, 6), `arr-${caseId}`);
    const permit = await uploadAs(caseId, 'State Permit.pdf', 'cremation_form.state_permit', await pdf(`PERMIT-${caseId}`, 2, [612, 1008]), `permit-${caseId}`);
    await pkg.confirmPermit(ctx(), caseId, shown(permit.id), 'mock');
  }
  const summaryOf = (caseId: string) => pkg.getCrematoryCaseSummary(ORG, caseId, true, 'mock');
  const requirement = async (caseId: string, key: string) => (await summaryOf(caseId)).readiness.requirements.find((r) => r.key === key)!;

  it('a ready case needs no name or date confirmation: from the intake form, the Expected Pickup and a confirmed permit, the package is built on its own', async () => {
    await intakeForm('1042', 'sub-1042', { first: 'RICHARD', last: 'REYNOLDS' });
    expectedPickup('1042', '2026-11-06');
    await documentsReady('1042');
    const summary = await summaryOf('1042');
    expect(summary.packageName).toMatchObject({ confirmed: { first: 'Richard', last: 'Reynolds' }, recordedFrom: 'intake_form' });
    expect(summary.readyDate).toEqual({ suggested: '11/06/2026', confirmed: '11/06/2026', recordedFrom: 'expected_pickup' });
    expect(summary.readiness.readyToSend).toBe(true);
    expect(docsOf('1042', PACKAGE).map((d) => d.fileName)).toEqual(['REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf']);
    expect(eventsOf('1042', 'crematory.package_name_recorded')[0].description).toBe('Name for the Crematory Package recorded from the intake form: Reynolds, Richard');
    expect(eventsOf('1042', 'crematory.ready_date_recorded')[0].description).toBe('Expected cremation ready date recorded from the Expected Pickup: 11/06/2026');
    expect(eventsOf('1042', 'crematory.package_name_confirmed')).toHaveLength(0);
    expect(eventsOf('1042', 'crematory.ready_date_confirmed')).toHaveLength(0);
  });

  it('the name is never taken from the case name alone — two words are only a suggestion for staff', async () => {
    expectedPickup('1042', '2026-11-06');
    await documentsReady('1042');
    const summary = await summaryOf('1042');
    expect(summary.packageName).toEqual({ confirmed: null, suggested: { first: 'Richard', last: 'Reynolds' }, suggestedFrom: 'case_name', recordedFrom: null });
    expect(summary.readiness.requirements.find((r) => r.key === 'package_name')!.ok).toBe(false);
    expect(docsOf('1042', PACKAGE)).toHaveLength(0);
  });

  it('keeps multi-word surnames whole', async () => {
    await intakeForm('1044', 'sub-1044', { first: 'ESTELA', last: 'SALAS RUEDA' });
    expectedPickup('1044', '2026-11-07');
    await documentsReady('1044');
    expect((await summaryOf('1044')).packageName.confirmed).toEqual({ first: 'Estela', last: 'Salas Rueda' });
    expect(docsOf('1044', PACKAGE)[0].fileName).toBe('SALAS RUEDA_ESTELA_CREMATORY_PACKAGE_11-07-2026.pdf');
  });

  it('forms that disagree, a name corrected on the case since the form, or a name staff already confirmed: left as they are, for staff', async () => {
    // Two forms that disagree.
    await intakeForm('1042', 'sub-a', { first: 'RICHARD', last: 'REYNOLDS' });
    await intakeForm('1042', 'sub-b', { first: 'RICHARD', last: 'RAYNOLDS' });
    await pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock');
    expect((await summaryOf('1042')).packageName.confirmed).toBeNull();

    // The case name corrected since the form (here, a suffix added).
    const { externalFormSubmissionFixtures } = await import('../__mocks__/externalFormFixtures');
    externalFormSubmissionFixtures.length = forms;
    await intakeForm('1044', 'sub-c', { first: 'ESTELA', last: 'SALAS' });
    await pkg.prepareCrematoryDocuments(ctx(), '1044', 'mock');
    expect((await summaryOf('1044')).packageName.confirmed).toBeNull();

    // A staff confirmation is never replaced.
    await pkg.confirmPackageName(ctx(), '1042', { first: 'Rick', last: 'Reynolds' }, 'mock');
    externalFormSubmissionFixtures.length = forms;
    await intakeForm('1042', 'sub-d', { first: 'RICHARD', last: 'REYNOLDS' });
    await pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock');
    expect((await summaryOf('1042')).packageName).toMatchObject({ confirmed: { first: 'Rick', last: 'Reynolds' }, recordedFrom: 'staff' });
    expect(eventsOf('1042', 'crematory.package_name_recorded')).toHaveLength(0);
    expect(eventsOf('1044', 'crematory.package_name_recorded')).toHaveLength(0);
  });

  it('a date from the Expected Pickup follows it until sent: the package is rebuilt and the earlier review no longer sends', async () => {
    await intakeForm('1042', 'sub-1042', { first: 'RICHARD', last: 'REYNOLDS' });
    expectedPickup('1042', '2026-11-06');
    await documentsReady('1042');
    const review = await reviewCrematorySend(ORG, ['1042'], 'mock');

    appointmentFixtures.find((a) => a.id === 'cremains-pickup-1042')!.startAt = '2026-11-10T05:00:00.000Z';
    // Until SOLIS catches up, the case is not ready — never sent with the old date.
    expect((await requirement('1042', 'ready_date')).ok).toBe(false);
    await pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock');
    expect((await summaryOf('1042')).readyDate).toEqual({ suggested: '11/10/2026', confirmed: '11/10/2026', recordedFrom: 'expected_pickup' });
    expect(docsOf('1042', PACKAGE).map((d) => [d.version, d.status, d.fileName])).toEqual([
      [1, 'superseded', 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf'],
      [2, 'active', 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-10-2026.pdf'],
    ]);
    expect(eventsOf('1042', 'crematory.ready_date_recorded').at(-1)!.description).toBe('Expected cremation ready date recorded from the Expected Pickup: 11/10/2026 (was 11/06/2026)');
    connectMockCrematoryMailbox(ORG, 'office@funeralhome.example', 'access-token');
    await expect(
      sendCrematoryPackages(ctx(), { caseIds: ['1042'], to: ['intake@crematory.example'], cc: [], subject: 'S', message: 'M', submissionId: 'sub-0000-0100', confirmResend: false, reviewFingerprint: review.fingerprint, acknowledged: true }, 'mock'),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('changed since you reviewed') });
  });

  it('a date staff entered is never changed: if the pickup moves afterwards, or is cancelled, the case needs attention', async () => {
    await readyCase('1042');
    await pkg.buildCrematoryPackage(ctx(), '1042', 'mock');
    const pickup = appointmentFixtures.find((a) => a.id === 'cremains-pickup-1042')!;
    pickup.startAt = '2026-11-10T05:00:00.000Z';
    await pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock');
    expect((await summaryOf('1042')).readyDate).toMatchObject({ confirmed: '11/06/2026', recordedFrom: 'staff' });
    expect(await requirement('1042', 'ready_date')).toMatchObject({ ok: false, detail: expect.stringContaining('Expected Pickup changed') });
    expect(docsOf('1042', PACKAGE)).toHaveLength(1);

    // A date taken from a pickup that is then cancelled is not trusted either.
    await intakeForm('1044', 'sub-1044', { first: 'ESTELA', last: 'SALAS RUEDA' });
    expectedPickup('1044', '2026-11-07');
    await documentsReady('1044');
    expect((await summaryOf('1044')).readiness.readyToSend).toBe(true);
    (appointmentFixtures.find((a) => a.id === 'cremains-pickup-1044')! as { status: string }).status = 'cancelled';
    await pkg.prepareCrematoryDocuments(ctx(), '1044', 'mock');
    expect((await requirement('1044', 'ready_date')).ok).toBe(false);
    await expect(reviewCrematorySend(ORG, ['1044'], 'mock')).rejects.toMatchObject({ status: 422 });
  });

  it('nothing is recorded on a case already sent', async () => {
    const c = caseFixtures[index('1042')];
    caseFixtures[index('1042')] = { ...c, crematory: { lastSubmission: { submissionId: 's', status: 'submitted', packageDocumentId: 'x', packageVersion: 1, attachmentName: 'x.pdf', to: [], cc: [], mailbox: null, internetMessageId: null, error: null, at: '2026-10-27T15:00:00.000Z', by: null } } };
    await intakeForm('1042', 'sub-1042', { first: 'RICHARD', last: 'REYNOLDS' });
    expectedPickup('1042', '2026-11-06');
    await pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock');
    expect(caseFixtures[index('1042')].crematory!.packageName ?? null).toBeNull();
    expect(caseFixtures[index('1042')].crematory!.readyDate ?? null).toBeNull();
  });
});

describe('one current State Cremation Permit per case (2026-10)', () => {
  const PERMIT = 'cremation_form.state_permit';
  const PACKAGE = 'cremation_form.crematory_package';
  const file = (fileName: string, bytes: Buffer) => ({ fileName, mimeType: 'application/pdf', bytes });
  const current = (caseId: string) => caseDocumentFixtures.filter((d) => d.caseId === caseId && d.documentTypeKey === PERMIT && d.status === 'active');

  it('the first permit is version 1; the same file again, or a second permit that does not say what it replaces, is refused — nothing stored', async () => {
    const bytes = await pdf('PERMIT-1042', 2, [612, 1008]);
    const { document, replaced } = await pkg.addPermit(ctx(), '1042', file('State Permit.pdf', bytes), { mayReplace: true }, 'mock');
    expect(document).toMatchObject({ documentTypeKey: PERMIT, version: 1, supersedesId: null, status: 'active' });
    expect(replaced).toBeNull();
    expect(eventsOf('1042', 'crematory.permit_added')[0].description).toBe('State Cremation Permit added: "State Permit.pdf". It must be confirmed before a package uses it.');
    const count = caseDocumentFixtures.length;
    await expect(pkg.addPermit(ctx(), '1042', file('Copy.pdf', bytes), { mayReplace: true }, 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining("already this case's State Cremation Permit") });
    await expect(pkg.addPermit(ctx(), '1042', file('Other.pdf', await pdf('PERMIT-B', 1)), { mayReplace: true }, 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Use Replace permit') });
    // A file already on the case without a type is chosen, not uploaded again.
    const untypedBytes = await pdf('UNTYPED-1044', 1);
    await upload({ caseId: '1044', fileName: 'SALAS PERMIT.pdf', mimeType: 'application/pdf', idFactory: () => 'untyped-1044' }, untypedBytes, ctx(), 'mock');
    const withUntyped = caseDocumentFixtures.length;
    await expect(pkg.addPermit(ctx(), '1044', file('Permit.pdf', untypedBytes), { mayReplace: true }, 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Choose it from this case's documents") });
    expect(caseDocumentFixtures.length).toBe(withUntyped);
    expect(withUntyped).toBe(count + 1);
  });

  it('a replacement names the permit it replaces and needs the prepare permission; the earlier permit is kept as superseded, and the new one is confirmed before the package is rebuilt', async () => {
    await readyCase('1042');
    expect(docsOf('1042', PACKAGE)).toHaveLength(1);
    const corrected = file('State Permit (corrected).pdf', await pdf('PERMIT-1042-B', 1));
    await expect(pkg.addPermit(ctx(), '1042', corrected, { replacesDocumentId: 'permit-1042', mayReplace: false }, 'mock')).rejects.toMatchObject({ status: 403 });
    await expect(pkg.addPermit(ctx(), '1042', corrected, { replacesDocumentId: 'permit-other', mayReplace: true }, 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('no longer the current one') });
    expect(current('1042').map((d) => d.id)).toEqual(['permit-1042']);

    const { document } = await pkg.addPermit(ctx(), '1042', corrected, { replacesDocumentId: 'permit-1042', mayReplace: true }, 'mock');
    expect(document).toMatchObject({ version: 2, supersedesId: 'permit-1042', status: 'active' });
    const earlier = caseDocumentFixtures.find((d) => d.id === 'permit-1042')!;
    expect(earlier.status).toBe('superseded');
    expect(createHash('sha256').update(blobs.get(earlier.storageKey)!.buffer).digest('hex')).toBe(earlier.checksumSha256);
    expect(eventsOf('1042', 'crematory.permit_replaced')[0].description).toContain('replaces "State Permit.pdf", which is kept as an earlier version');
    let summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.readiness.requirements.filter((r) => !r.ok).map((r) => r.key)).toEqual(['permit_verified', 'package']);
    // The earlier confirmation is cleared (it stays in the case activity); the package is outdated, not rebuilt.
    expect(caseFixtures[index('1042')].crematory!.permitVerification).toBeNull();
    expect(eventsOf('1042', 'crematory.permit_confirmed')).toHaveLength(1);
    expect(summary.permit).toMatchObject({ documentId: document.id });
    expect(summary.package).toMatchObject({ current: false });
    expect(docsOf('1042', PACKAGE)).toHaveLength(1);
    // The same replacement again (a double click): refused, nothing more stored.
    await expect(pkg.addPermit(ctx(), '1042', corrected, { replacesDocumentId: 'permit-1042', mayReplace: true }, 'mock')).rejects.toMatchObject({ status: 409 });
    expect(current('1042').map((d) => d.id)).toEqual([document.id]);

    await pkg.confirmPermit(ctx(), '1042', shown(document.id), 'mock');
    summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.readiness.readyToSend).toBe(true);
    expect(docsOf('1042', PACKAGE).map((d) => [d.version, d.status])).toEqual([[1, 'superseded'], [2, 'active']]);
  });

  it('two replacements at once: exactly one wins, the other is refused', async () => {
    await readyCase('1042');
    const results = await Promise.allSettled([
      pkg.addPermit(ctx(), '1042', file('A.pdf', await pdf('PERMIT-A', 1)), { replacesDocumentId: 'permit-1042', mayReplace: true }, 'mock'),
      pkg.addPermit(ctx(), '1042', file('B.pdf', await pdf('PERMIT-B', 1)), { replacesDocumentId: 'permit-1042', mayReplace: true }, 'mock'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(current('1042')).toHaveLength(1);
    expect(caseFixtures[index('1042')].crematory!.preparing).toBeNull();
  });

  it('if the new permit cannot be stored, the earlier permit stays current — nothing is half-replaced', async () => {
    await readyCase('1042');
    const { vercelBlobStorageProvider } = await import('../../lib/vercelBlob/vercelBlobStorageProvider');
    vi.spyOn(vercelBlobStorageProvider, 'uploadFile').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(pkg.addPermit(ctx(), '1042', file('New.pdf', await pdf('PERMIT-NEW', 1)), { replacesDocumentId: 'permit-1042', mayReplace: true }, 'mock')).rejects.toMatchObject({ status: 503 });
    expect(current('1042').map((d) => d.id)).toEqual(['permit-1042']);
    expect((await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock')).readiness.readyToSend).toBe(true);
    vi.restoreAllMocks();
  });

  it('a case already sent: no permit is added or replaced, and its sent package is never rebuilt', async () => {
    await readyCase('1042');
    const c = caseFixtures[index('1042')];
    caseFixtures[index('1042')] = { ...c, crematory: { ...c.crematory!, lastSubmission: { submissionId: 's', status: 'submitted', packageDocumentId: docsOf('1042', PACKAGE)[0].id, packageVersion: 1, attachmentName: 'x.pdf', to: [], cc: [], mailbox: null, internetMessageId: null, error: null, at: '2026-10-27T15:00:00.000Z', by: null } } };
    const count = caseDocumentFixtures.length;
    const message = expect.stringContaining('upload it without a document type');
    await expect(pkg.addPermit(ctx(), '1042', file('New.pdf', await pdf('PERMIT-NEW', 1)), { replacesDocumentId: 'permit-1042', mayReplace: true }, 'mock')).rejects.toMatchObject({ status: 409, message });
    await expect(pkg.addPermit(ctx(), '1042', file('New.pdf', await pdf('PERMIT-NEW', 1)), { mayReplace: true }, 'mock')).rejects.toMatchObject({ status: 409 });
    await expect(pkg.buildCrematoryPackageNow(ctx(), '1042', 'mock')).rejects.toMatchObject({ status: 409 });
    expect(caseDocumentFixtures.length).toBe(count);
    expect(current('1042').map((d) => d.id)).toEqual(['permit-1042']);
    // The sent package is exactly as it was.
    expect(docsOf('1042', PACKAGE).map((d) => [d.version, d.status])).toEqual([[1, 'active']]);
    expect(caseFixtures[index('1042')].crematory!.permitVerification).toMatchObject({ documentId: 'permit-1042' });
  });

  it('two current permits (from before): never ready and never resolved automatically; staff choose one and the other is kept as an earlier version', async () => {
    await uploadAs('1042', 'Permit A.pdf', PERMIT, await pdf('PERMIT-A', 1), 'permit-a');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await uploadAs('1042', 'Permit B.pdf', PERMIT, await pdf('PERMIT-B', 1), 'permit-b');
    expect((await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock')).readiness.requirements.find((r) => r.key === 'permit_uploaded')).toMatchObject({
      ok: false,
      detail: '2 state permits are current on this case. Choose the one to use; the others are kept as earlier versions.',
    });
    await pkg.prepareCrematoryDocuments(ctx(), '1042', 'mock');
    expect(current('1042')).toHaveLength(2);
    await expect(pkg.confirmPermit(ctx(), '1042', shown('permit-b'), 'mock')).rejects.toMatchObject({ status: 409 });
    await expect(pkg.addPermit(ctx(), '1042', file('C.pdf', await pdf('PERMIT-C', 1)), { replacesDocumentId: 'permit-b', mayReplace: true }, 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Choose the one to use') });

    const summary = await pkg.chooseCurrentPermit(ctx(), '1042', 'permit-a', 'mock', true);
    expect(current('1042').map((d) => d.id)).toEqual(['permit-a']);
    expect(caseDocumentFixtures.find((d) => d.id === 'permit-b')!.status).toBe('superseded');
    expect(summary.permit).toMatchObject({ documentId: 'permit-a' });
    expect(summary.readiness.requirements.find((r) => r.key === 'permit_verified')!.ok).toBe(false);
    expect(eventsOf('1042', 'crematory.current_permit_chosen')[0].description).toBe('"Permit A.pdf" chosen as the current State Cremation Permit; "Permit B.pdf" kept as earlier versions');
    await expect(pkg.chooseCurrentPermit(ctx(), '1042', 'permit-a', 'mock')).rejects.toMatchObject({ status: 409 });
  });
});

describe('a possible earlier send outside SOLIS (2026-10)', () => {
  const WARNING = 'This case indicates that documents may already have been sent to the crematory outside SOLIS. Verify the previous send before continuing.';
  /** Workflow 3's "Permit sent to crematory" checked by staff — with no SOLIS send. */
  const markPermitSent = (caseId: string) => {
    const c = caseFixtures[index(caseId)];
    caseFixtures[index(caseId)] = { ...c, checklistState: { ...(c.checklistState ?? {}), '3:0': true } };
  };
  const requirementOf = async (caseId: string) => (await pkg.getCrematoryCaseSummary(ORG, caseId, true, 'mock')).readiness.requirements.find((r) => r.key === 'previous_send');
  const B = { decision: 'not_previously_sent', verification: 'Outlook Sent Items and the fax log for October', confirmedChecked: true };
  const A = { decision: 'sent_outside_solis', method: 'email', sentOn: '2026-10-21', verification: 'Found the email in Outlook Sent Items' };

  it('is flagged — never taken as a send, never ignored — and blocks the first send (alone or in a batch) until staff record what happened; the package is still prepared', async () => {
    await readyCase('1042');
    await readyCase('1044');
    markPermitSent('1042');
    const summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.previousSend).toEqual({ indicated: true, recorded: null });
    expect(await requirementOf('1042')).toEqual({ key: 'previous_send', label: 'No earlier send outside SOLIS', ok: false, detail: WARNING });
    expect(summary.readiness).toMatchObject({ readyToBuild: true, readyToSend: false });
    expect(docsOf('1042', 'cremation_form.crematory_package')).toHaveLength(1);
    expect(caseFixtures[index('1042')].crematory!.lastSubmission ?? null).toBeNull();
    await expect(reviewCrematorySend(ORG, ['1042', '1044'], 'mock')).rejects.toMatchObject({ status: 422, message: expect.stringContaining('B2026-901') });
    // Not flagged without the checked step.
    expect(await requirementOf('1044')).toBeUndefined();
  });

  it('a simple acknowledgment is not enough: the decision, how it was verified, and (B) the explicit confirmation — or (A) the method — are required; a future date is refused', async () => {
    await readyCase('1042');
    markPermitSent('1042');
    for (const input of [{}, { decision: 'not_previously_sent' }, { ...B, verification: 'ok' }, { ...B, confirmedChecked: false }, { ...A, method: undefined }, { ...A, method: 'pigeon' }, { ...A, sentOn: '2099-01-01' }, { ...A, sentOn: 'yesterday' }]) {
      await expect(pkg.recordPreviousSend(ctx(), '1042', input, 'mock')).rejects.toMatchObject({ status: 422 });
    }
    expect(caseFixtures[index('1042')].crematory!.previousSend ?? null).toBeNull();
    expect(eventsOf('1042', 'crematory.previous_send_recorded')).toHaveLength(0);
  });

  it('B — not previously sent: recorded once with who, when and what was checked; the case can then be reviewed and sent as usual', async () => {
    await readyCase('1042');
    markPermitSent('1042');
    const summary = await pkg.recordPreviousSend(ctx('staff-lee'), '1042', B, 'mock', true);
    expect(summary.previousSend).toMatchObject({ indicated: false, recorded: { decision: 'not_previously_sent', verification: 'Outlook Sent Items and the fax log for October', recordedBy: 'staff-lee', recordedAt: expect.any(String) } });
    expect((await requirementOf('1042'))!.ok).toBe(true);
    expect(summary.readiness.readyToSend).toBe(true);
    const [event] = eventsOf('1042', 'crematory.previous_send_recorded');
    expect(event.actorIdentityId).toBe('staff-lee');
    expect(event.description).toBe('Recorded as NOT previously sent to the crematory, after checking the sending records. Checked: Outlook Sent Items and the fax log for October');
    expect(JSON.parse(event.newValue!)).toMatchObject({ decision: 'not_previously_sent', verifiedBy: 'staff-lee', verifiedAt: expect.any(String) });
    await expect(reviewCrematorySend(ORG, ['1042'], 'mock')).resolves.toMatchObject({ fingerprint: expect.stringMatching(/^v1:/) });
    // Recorded once.
    await expect(pkg.recordPreviousSend(ctx(), '1042', A, 'mock')).rejects.toMatchObject({ status: 409 });
    // The checklist is never touched.
    expect(caseFixtures[index('1042')].checklistState!['3:0']).toBe(true);
  });

  it('A — sent outside SOLIS: recorded with the method and date; the case is never sent through the first send, not even with the resend confirmation', async () => {
    await readyCase('1042');
    markPermitSent('1042');
    await pkg.recordPreviousSend(ctx(), '1042', A, 'mock');
    expect(await requirementOf('1042')).toMatchObject({ ok: false, detail: 'Recorded as already sent to the crematory outside SOLIS (Email, 10/21/2026). It is not sent again through the first send.' });
    expect(eventsOf('1042', 'crematory.previous_send_recorded')[0].description).toBe(
      'Recorded as already sent to the crematory outside SOLIS (Email, 10/21/2026) — not sent again through the first send. Verified: Found the email in Outlook Sent Items',
    );
    await expect(reviewCrematorySend(ORG, ['1042'], 'mock')).rejects.toMatchObject({ status: 422 });
    connectMockCrematoryMailbox(ORG, 'office@funeralhome.example', 'access-token');
    await expect(
      sendCrematoryPackages(ctx(), { caseIds: ['1042'], to: ['intake@crematory.example'], cc: [], subject: 'S', message: 'M', submissionId: 'sub-0000-0200', confirmResend: true, reviewFingerprint: 'v1:x', acknowledged: true }, 'mock'),
    ).rejects.toMatchObject({ status: 422 });
    // Unticking the step later never clears what was recorded.
    caseFixtures[index('1042')] = { ...caseFixtures[index('1042')], checklistState: { ...caseFixtures[index('1042')].checklistState, '3:0': false } };
    expect((await requirementOf('1042'))!.ok).toBe(false);
  });

  it('nothing to record where SOLIS itself sent the case or the step is not checked; only for organizations with Send to Crematory', async () => {
    await readyCase('1042');
    await expect(pkg.recordPreviousSend(ctx(), '1042', B, 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('does not show a possible earlier send') });
    markPermitSent('1042');
    const c = caseFixtures[index('1042')];
    caseFixtures[index('1042')] = { ...c, crematory: { ...c.crematory!, lastSubmission: { submissionId: 's', status: 'submitted', packageDocumentId: 'x', packageVersion: 1, attachmentName: 'x.pdf', to: [], cc: [], mailbox: null, internetMessageId: null, error: null, at: '2026-10-27T15:00:00.000Z', by: null } } };
    expect((await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock')).previousSend.indicated).toBe(false);
    await expect(pkg.recordPreviousSend(ctx(), '1042', B, 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('SOLIS already has a send') });
    await expect(pkg.recordPreviousSend({ ...ctx(), organizationId: 'gus-camacho-jr' }, '1042', B, 'mock')).rejects.toMatchObject({ status: 404 });
  });
});

describe('an administrator corrects an earlier-send record (2026-10)', () => {
  const markPermitSent = (caseId: string) => {
    const c = caseFixtures[index(caseId)];
    caseFixtures[index(caseId)] = { ...c, checklistState: { ...(c.checklistState ?? {}), '3:0': true } };
  };
  const A = { decision: 'sent_outside_solis', method: 'email', sentOn: '2026-10-21', verification: 'Found the email in Outlook Sent Items' };
  const B = { decision: 'not_previously_sent', verification: 'Outlook Sent Items and the fax log for October', confirmedChecked: true };
  const ready = async (caseId: string) => (await pkg.getCrematoryCaseSummary(ORG, caseId, true, 'mock')).readiness;

  it('corrects A → B → A: each needs a reason, every earlier answer is kept, each is in the case activity, and readiness follows the latest', async () => {
    await readyCase('1042');
    markPermitSent('1042');
    await pkg.recordPreviousSend(ctx('staff-lee'), '1042', A, 'mock');
    expect((await ready('1042')).readyToSend).toBe(false);

    await expect(pkg.correctPreviousSend(ctx('admin-ana'), '1042', { ...B, reason: 'short' }, 'mock')).rejects.toMatchObject({ status: 422 });
    await expect(pkg.correctPreviousSend(ctx('admin-ana'), '1042', { ...B, confirmedChecked: false, reason: 'Recorded on the wrong case' }, 'mock')).rejects.toMatchObject({ status: 422 });

    await pkg.correctPreviousSend(ctx('admin-ana'), '1042', { ...B, reason: 'Recorded on the wrong case' }, 'mock');
    let record = caseFixtures[index('1042')].crematory!.previousSend!;
    expect(record).toMatchObject({ decision: 'not_previously_sent', recordedBy: 'admin-ana', correction: { reason: 'Recorded on the wrong case', correctedBy: 'admin-ana' } });
    expect(record.earlier).toEqual([expect.objectContaining({ decision: 'sent_outside_solis', recordedBy: 'staff-lee', verification: 'Found the email in Outlook Sent Items' })]);
    // Back in the first send — every other check still applies.
    expect((await ready('1042')).readyToSend).toBe(true);
    const [event] = eventsOf('1042', 'crematory.previous_send_corrected');
    expect(event.actorIdentityId).toBe('admin-ana');
    expect(event.description).toBe('Earlier-send record corrected by an administrator: was "sent outside SOLIS (Email, 10/21/2026)", now "not previously sent". Reason: Recorded on the wrong case');
    expect(JSON.parse(event.newValue!)).toMatchObject({ previous: { decision: 'sent_outside_solis', recordedBy: 'staff-lee' }, corrected: { decision: 'not_previously_sent' }, reason: 'Recorded on the wrong case', correctedBy: 'admin-ana' });

    await pkg.correctPreviousSend(ctx('admin-ana'), '1042', { ...A, reason: 'Found the fax confirmation after all' }, 'mock');
    record = caseFixtures[index('1042')].crematory!.previousSend!;
    expect(record.decision).toBe('sent_outside_solis');
    expect(record.earlier!.map((e) => [e.decision, e.correction?.reason ?? null])).toEqual([
      ['sent_outside_solis', null],
      ['not_previously_sent', 'Recorded on the wrong case'],
    ]);
    expect((await ready('1042')).readyToSend).toBe(false);
    expect(eventsOf('1042', 'crematory.previous_send_corrected')).toHaveLength(2);
  });

  it('refused — nothing changed — with nothing recorded, while SOLIS is sending the case, or once SOLIS sent it; only for organizations with Send to Crematory', async () => {
    await readyCase('1042');
    await expect(pkg.correctPreviousSend(ctx(), '1042', { ...B, reason: 'Nothing recorded yet here' }, 'mock')).rejects.toMatchObject({ status: 409 });
    markPermitSent('1042');
    await pkg.recordPreviousSend(ctx(), '1042', B, 'mock');
    const base = caseFixtures[index('1042')];
    for (const crematory of [
      { ...base.crematory!, pendingSubmission: { submissionId: 's2', startedAt: new Date().toISOString(), startedBy: 'staff-lee' } },
      { ...base.crematory!, lastSubmission: { submissionId: 's', status: 'submitted' as const, packageDocumentId: 'x', packageVersion: 1, attachmentName: 'x.pdf', to: [], cc: [], mailbox: null, internetMessageId: null, error: null, at: '2026-10-27T15:00:00.000Z', by: null } },
    ]) {
      caseFixtures[index('1042')] = { ...base, crematory };
      await expect(pkg.correctPreviousSend(ctx(), '1042', { ...A, reason: 'Trying to correct during a send' }, 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('SOLIS is sending, or has sent') });
      expect(caseFixtures[index('1042')].crematory!.previousSend!.decision).toBe('not_previously_sent');
    }
    await expect(pkg.correctPreviousSend({ ...ctx(), organizationId: 'gus-camacho-jr' }, '1042', { ...A, reason: 'Another organization' }, 'mock')).rejects.toMatchObject({ status: 404 });
    expect(eventsOf('1042', 'crematory.previous_send_corrected')).toHaveLength(0);
  });
});

describe('a permit is confirmed or chosen only as shown in SOLIS (2026-10)', () => {
  it('confirming needs the checksum of the PDF shown — exactly the stored permit — and records its document, version and checksum', async () => {
    await uploadAs('1042', 'Arrangement Forms.pdf', 'external_form.arrangement_forms', await pdf('ARRANGEMENT-1042', 6), 'arr-1042');
    const { document } = await pkg.addPermit(ctx(), '1042', { fileName: 'State Permit.pdf', mimeType: 'application/pdf', bytes: await pdf('PERMIT-1042', 2, [612, 1008]) }, { mayReplace: true }, 'mock');
    await expect(pkg.confirmPermit(ctx(), '1042', { documentId: document.id, displayedChecksumSha256: null }, 'mock')).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Open the permit in SOLIS') });
    await expect(pkg.confirmPermit(ctx(), '1042', { documentId: document.id, displayedChecksumSha256: 'f'.repeat(64) }, 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('not the stored permit') });
    expect(caseFixtures[index('1042')].crematory?.permitVerification ?? null).toBeNull();

    await pkg.confirmPermit(ctx('staff-lee'), '1042', shown(document.id), 'mock');
    expect(caseFixtures[index('1042')].crematory!.permitVerification).toMatchObject({ documentId: document.id, version: 1, checksumSha256: document.checksumSha256, displayedInSolis: true, verifiedBy: 'staff-lee' });
    expect(JSON.parse(eventsOf('1042', 'crematory.permit_confirmed')[0].newValue!)).toMatchObject({ documentId: document.id, version: 1, checksumSha256: document.checksumSha256, displayedInSolis: true });

    // Replaced: the old confirmation is cleared, and what was shown for the old file never confirms the new one.
    const { document: replacement } = await pkg.addPermit(ctx(), '1042', { fileName: 'Corrected.pdf', mimeType: 'application/pdf', bytes: await pdf('PERMIT-1042-B', 1) }, { replacesDocumentId: document.id, mayReplace: true }, 'mock');
    expect(caseFixtures[index('1042')].crematory!.permitVerification).toBeNull();
    await expect(pkg.confirmPermit(ctx(), '1042', { documentId: replacement.id, displayedChecksumSha256: document.checksumSha256 }, 'mock')).rejects.toMatchObject({ status: 409 });
    await pkg.confirmPermit(ctx(), '1042', shown(replacement.id), 'mock');
    expect(caseFixtures[index('1042')].crematory!.permitVerification).toMatchObject({ documentId: replacement.id, version: 2, displayedInSolis: true });
  });

  it('choosing an untyped PDF as the permit needs that exact PDF shown; an Arrangement Form does not', async () => {
    const permit = await upload({ caseId: '1042', fileName: 'FICTIONAL PERMIT.pdf', mimeType: 'application/pdf', idFactory: () => 'untyped-permit' }, await pdf('PERMIT', 1), ctx(), 'mock');
    const other = await upload({ caseId: '1042', fileName: 'OTHER.pdf', mimeType: 'application/pdf', idFactory: () => 'untyped-other' }, await pdf('OTHER', 1), ctx(), 'mock');
    await expect(pkg.assignSourceDocument(ctx(), '1042', permit.id, 'state_permit', 'mock')).rejects.toMatchObject({ status: 400 });
    await expect(pkg.assignSourceDocument(ctx(), '1042', permit.id, 'state_permit', 'mock', false, other.checksumSha256)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('not that document') });
    expect(caseDocumentFixtures.find((d) => d.id === permit.id)!.documentTypeKey).toBeNull();
    await pkg.assignSourceDocument(ctx(), '1042', permit.id, 'state_permit', 'mock', false, permit.checksumSha256);
    expect(caseDocumentFixtures.find((d) => d.id === permit.id)!.documentTypeKey).toBe('cremation_form.state_permit');
    // Still needs confirming, as before.
    expect((await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock')).readiness.requirements.find((r) => r.key === 'permit_verified')!.ok).toBe(false);
  });
});

