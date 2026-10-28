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

const pkg = await import('./crematoryPackageService');
const { sendCrematoryPackages } = await import('./crematorySendService');
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

/** Everything a case needs, up to (not including) building the package. */
async function readyCase(caseId: string, readyDate = '11/06/2026', iso = '2026-11-06') {
  const arrangement = await pdf(`ARRANGEMENT-${caseId}`, 6);
  await uploadAs(caseId, 'Arrangement Forms.pdf', 'external_form.arrangement_forms', arrangement, `arr-${caseId}`);
  const permit = await pdf(`PERMIT-${caseId}`, 2, [612, 1008]);
  const permitDoc = await uploadAs(caseId, 'State Permit.pdf', 'cremation_form.state_permit', permit, `permit-${caseId}`);
  expectedPickup(caseId, iso);
  await pkg.confirmPermit(ctx(), caseId, permitDoc.id, 'mock');
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
});

const docsOf = (caseId: string, type: string) => caseDocumentFixtures.filter((d) => d.caseId === caseId && d.documentTypeKey === type).sort((a, b) => Number(a.version) - Number(b.version));
const eventsOf = (caseId: string, type: string) => activityEventFixtures.slice(lengths.activity).filter((e) => e.caseId === caseId && e.eventType === type);

describe('readiness — what needs attention', () => {
  it('a bare case lists every missing piece; nothing is sent or built on its own', async () => {
    const summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.readiness.readyToBuild).toBe(false);
    expect(summary.readiness.requirements.filter((r) => !r.ok).map((r) => r.key)).toEqual(['permit_uploaded', 'permit_verified', 'crematory_form', 'package_name', 'ready_date', 'package']);
    // No name is ever split out of "RICHARD REYNOLDS".
    expect(summary.packageName).toEqual({ confirmed: null, suggested: null });
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
    expect(summary.readyDate).toEqual({ suggested: '11/06/2026', confirmed: null });
    expect(summary.readiness.requirements.find((r) => r.key === 'ready_date')).toMatchObject({ ok: false });
  });

  it('workflow 2 must be complete', async () => {
    await readyCase('1042');
    caseFixtures[index('1042')] = { ...caseFixtures[index('1042')], checklistState: { '2:0': true } };
    await expect(pkg.buildCrematoryPackage(ctx(), '1042', 'mock')).rejects.toMatchObject({ status: 422, message: expect.stringContaining('workflow 2') });
  });
});

describe('the Crematory Package — one PDF per decedent', () => {
  it('puts every permit page first, then Arrangement Form page 3 — unchanged — under LastName_FirstName_MM-DD-YYYY.pdf', async () => {
    const { permit, arrangement } = await readyCase('1042');
    const { outcome, summary } = await pkg.buildCrematoryPackage(ctx(), '1042', 'mock', true);
    expect(outcome).toBe('saved');
    expect(summary.readiness.readyToSend).toBe(true);
    // Without the send permission the package is built but not sendable.
    expect((await pkg.getCrematoryCaseSummary(ORG, '1042', false, 'mock')).readiness).toMatchObject({ readyToBuild: true, readyToSend: false });
    const [saved] = docsOf('1042', 'cremation_form.crematory_package');
    expect(saved).toMatchObject({ fileName: 'Reynolds_Richard_11-06-2026.pdf', mimeType: 'application/pdf', version: 1, status: 'active', generatedBy: 'staff-dana' });

    const merged = await loadPdf(blobs.get(saved.storageKey)!.buffer);
    const permitPdf = await loadPdf(permit);
    const arrangementPdf = await loadPdf(arrangement);
    expect(merged.getPageCount()).toBe(3);
    expect(await contentOf(merged.getPage(0))).toBe(await contentOf(permitPdf.getPage(0)));
    expect(await contentOf(merged.getPage(1))).toBe(await contentOf(permitPdf.getPage(1)));
    expect(await contentOf(merged.getPage(2))).toBe(await contentOf(arrangementPdf.getPage(2)));
    expect(merged.getPage(0).getSize()).toEqual({ width: 612, height: 1008 });
    expect(eventsOf('1042', 'crematory.package_built')[0].description).toBe('Crematory Package v1 built: Reynolds_Richard_11-06-2026.pdf');
  });

  it('MARY ANN SMITH is named from the confirmed parts — Smith_Mary Ann — and the case name is never changed', async () => {
    caseFixtures[index('1042')] = { ...caseFixtures[index('1042')], decedentName: 'MARY ANN SMITH' };
    await readyCase('1042');
    await pkg.confirmPackageName(ctx(), '1042', { first: 'Mary Ann', last: 'Smith' }, 'mock');
    await pkg.buildCrematoryPackage(ctx(), '1042', 'mock');
    expect(docsOf('1042', 'cremation_form.crematory_package')[0].fileName).toBe('Smith_Mary Ann_11-06-2026.pdf');
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
      expect((await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock')).packageName).toEqual({ confirmed: null, suggested: { first: 'Mary Ann', last: 'Smith' } });
    } finally {
      externalFormSubmissionFixtures.length = before;
    }
  });

  it('refuses an incomplete name', async () => {
    await expect(pkg.confirmPackageName(ctx(), '1042', { first: 'Mary Ann', last: ' ' }, 'mock')).rejects.toMatchObject({ status: 422 });
  });

  it('keeps multi-word surnames whole in the file name', async () => {
    await readyCase('1044', '11/07/2026', '2026-11-07');
    await pkg.buildCrematoryPackage(ctx(), '1044', 'mock');
    expect(docsOf('1044', 'cremation_form.crematory_package')[0].fileName).toBe('Salas Rueda_Estela_11-07-2026.pdf');
  });

  it('building again with nothing changed creates nothing; a new permit, a new date or a newer page 3 each need review and a rebuild', async () => {
    await readyCase('1042');
    await pkg.buildCrematoryPackage(ctx(), '1042', 'mock');
    expect((await pkg.buildCrematoryPackage(ctx(), '1042', 'mock')).outcome).toBe('unchanged');
    expect(docsOf('1042', 'cremation_form.crematory_package')).toHaveLength(1);

    // A corrected permit: unconfirmed until staff confirm it; the old package is stale.
    const newPermit = await uploadAs('1042', 'State Permit (corrected).pdf', 'cremation_form.state_permit', await pdf('PERMIT-2', 1), 'permit-1042-b');
    let summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.readiness.requirements.filter((r) => !r.ok).map((r) => r.key)).toEqual(['permit_verified', 'package']);
    await expect(pkg.buildCrematoryPackage(ctx(), '1042', 'mock')).rejects.toMatchObject({ status: 422 });
    await pkg.confirmPermit(ctx(), '1042', newPermit.id, 'mock');
    expect((await pkg.buildCrematoryPackage(ctx(), '1042', 'mock')).outcome).toBe('saved');

    // A different confirmed date renames the package.
    await pkg.confirmReadyDate(ctx(), '1042', '11/09/2026', 'mock');
    summary = await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock');
    expect(summary.package).toMatchObject({ current: false });
    await pkg.buildCrematoryPackage(ctx(), '1042', 'mock');

    const versions = docsOf('1042', 'cremation_form.crematory_package');
    expect(versions.map((d) => [d.version, d.status, d.fileName])).toEqual([
      [1, 'superseded', 'Reynolds_Richard_11-06-2026.pdf'],
      [2, 'superseded', 'Reynolds_Richard_11-06-2026.pdf'],
      [3, 'active', 'Reynolds_Richard_11-09-2026.pdf'],
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

  it('a permit confirmation is for one file: confirming a stale id is refused', async () => {
    await uploadAs('1042', 'State Permit.pdf', 'cremation_form.state_permit', await pdf('PERMIT', 1), 'permit-old');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await uploadAs('1042', 'State Permit 2.pdf', 'cremation_form.state_permit', await pdf('PERMIT-B', 1), 'permit-new');
    await expect(pkg.confirmPermit(ctx(), '1042', 'permit-old', 'mock')).rejects.toMatchObject({ status: 409 });
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
    ...over,
  });
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
    const result = await sendCrematoryPackages(ctx('staff-lee'), request(), 'mock');
    expect(result).toMatchObject({ status: 'submitted', duplicate: false, mailbox: 'office@funeralhome.example', internetMessageId: '<msg-1@outlook>' });

    expect(calls.filter(([url]) => url.endsWith('/me/messages'))).toHaveLength(1);
    const attached = calls.filter(([url]) => url.endsWith('/attachments')).map(([, init]) => JSON.parse(String(init!.body)));
    expect(attached.map((a) => a.name)).toEqual(['Reynolds_Richard_11-06-2026.pdf', 'Salas Rueda_Estela_11-06-2026.pdf']);
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
    await sendCrematoryPackages(ctx(), request(), 'mock');
    const again = await sendCrematoryPackages(ctx(), request(), 'mock');
    expect(again.duplicate).toBe(true);

    await expect(sendCrematoryPackages(ctx(), request({ submissionId: 'sub-0000-0002' }), 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Each case is sent only once') });
    await expect(sendCrematoryPackages(ctx(), request({ submissionId: 'sub-0000-0003', confirmResend: true }), 'mock')).rejects.toMatchObject({ status: 409 });
    // Even with a rebuilt package (a new date), a sent case stays sent.
    await pkg.confirmReadyDate(ctx(), '1042', '11/09/2026', 'mock');
    await pkg.buildCrematoryPackage(ctx(), '1042', 'mock');
    await expect(sendCrematoryPackages(ctx(), request({ caseIds: ['1042'], submissionId: 'sub-0000-0007', confirmResend: true }), 'mock')).rejects.toMatchObject({ status: 409 });
    expect(calls.filter(([url]) => url.endsWith('/send'))).toHaveLength(1);
    expect((await pkg.getCrematoryCaseSummary(ORG, '1042', true, 'mock')).readiness.readyToSend).toBe(false);
  });

  it('a case that is not ready blocks the whole email — nothing is sent', async () => {
    await twoReadyCases();
    caseFixtures[index('1044')] = { ...caseFixtures[index('1044')], checklistState: { '2:0': true } };
    const calls = fakeGraph();
    await expect(sendCrematoryPackages(ctx(), request(), 'mock')).rejects.toMatchObject({ status: 422, message: expect.stringContaining('B2026-902') });
    expect(calls).toHaveLength(0);
  });

  it('no connected mailbox, or no recipient: nothing is sent', async () => {
    await readyCase('1042');
    await pkg.buildCrematoryPackage(ctx(), '1042', 'mock');
    const calls = fakeGraph();
    await expect(sendCrematoryPackages(ctx(), request({ caseIds: ['1042'] }), 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('No Outlook mailbox') });
    connectMockCrematoryMailbox(ORG, 'office@funeralhome.example', 'access-token');
    await expect(sendCrematoryPackages(ctx(), request({ caseIds: ['1042'], to: [] }), 'mock')).rejects.toMatchObject({ status: 400 });
    await expect(sendCrematoryPackages(ctx(), request({ caseIds: ['1042'], to: ['not-an-email'] }), 'mock')).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
  });

  it('a failure before sending is recorded as not sent and can be retried; a failing send call is recorded as uncertain', async () => {
    await twoReadyCases();
    fakeGraph({ failAttachment: true });
    await expect(sendCrematoryPackages(ctx(), request(), 'mock')).rejects.toMatchObject({ status: 502, message: expect.stringContaining('Nothing was sent') });
    expect(caseFixtures[index('1042')].crematory!.lastSubmission).toMatchObject({ status: 'failed' });
    expect(eventsOf('1042', 'crematory.package_send_failed')).toHaveLength(1);

    // A failing send call is recorded as uncertain ("may have been sent").
    fakeGraph({ failSend: 503 });
    await expect(sendCrematoryPackages(ctx(), request({ submissionId: 'sub-0000-0005' }), 'mock')).rejects.toMatchObject({ message: expect.stringContaining('may still have been sent') });
    expect(caseFixtures[index('1042')].crematory!.lastSubmission).toMatchObject({ status: 'uncertain' });
    // It is retried only after staff confirm, from Sent Items, that it did not go out.
    fakeGraph();
    await expect(sendCrematoryPackages(ctx(), request({ submissionId: 'sub-0000-0006' }), 'mock')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Check Sent Items') });
    await expect(sendCrematoryPackages(ctx(), request({ submissionId: 'sub-0000-0004', confirmResend: true }), 'mock')).resolves.toMatchObject({ status: 'submitted' });
  });

  it('two decedents with the same name and date never share an attachment name', async () => {
    caseFixtures[index('1044')] = { ...caseFixtures[index('1044')], decedentName: 'RICHARD REYNOLDS' };
    await twoReadyCases();
    await pkg.confirmPackageName(ctx(), '1044', { first: 'Richard', last: 'Reynolds' }, 'mock');
    await pkg.buildCrematoryPackage(ctx(), '1044', 'mock');
    const calls = fakeGraph();
    await sendCrematoryPackages(ctx(), request(), 'mock');
    const names = calls.filter(([url]) => url.endsWith('/attachments')).map(([, init]) => JSON.parse(String(init!.body)).name);
    expect(names).toEqual(['Reynolds_Richard_11-06-2026_B2026-901.pdf', 'Reynolds_Richard_11-06-2026_B2026-902.pdf']);
  });

  it('a package whose stored file no longer matches its checksum is never sent', async () => {
    await twoReadyCases();
    const saved = docsOf('1042', 'cremation_form.crematory_package')[0];
    blobs.set(saved.storageKey, { buffer: Buffer.from('tampered'), contentType: 'application/pdf' });
    const calls = fakeGraph();
    await expect(sendCrematoryPackages(ctx(), request(), 'mock')).rejects.toMatchObject({ status: 503 });
    expect(calls.some(([url]) => url.endsWith('/send'))).toBe(false);
  });
});

describe('the Cases page list', () => {
  it('lists open cremation cases with what each still needs, ready ones first', async () => {
    await readyCase('1044');
    await pkg.buildCrematoryPackage(ctx(), '1044', 'mock');
    const list = await pkg.listCrematoryCandidates(ORG, true, 'mock');
    const mine = list.filter((c) => c.caseId === '1042' || c.caseId === '1044');
    expect(mine[0]).toMatchObject({ caseId: '1044', readiness: { readyToSend: true }, package: { fileName: 'Salas Rueda_Estela_11-06-2026.pdf' } });
    expect(mine[1]).toMatchObject({ caseId: '1042', readiness: { readyToSend: false } });
    expect(list.every((c) => caseFixtures.find((x) => x.id === c.caseId)?.caseType === 'cremation')).toBe(true);
  });
});
