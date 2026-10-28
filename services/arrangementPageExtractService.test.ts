import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, type PDFPage } from 'pdf-lib';

/**
 * ME Form / Crematory Form (2026-10). The real extraction service and case
 * document pipeline in mock mode; document storage in memory; fictional
 * Arrangement Forms PDFs only.
 */
const { blobs } = vi.hoisted(() => ({ blobs: new Map<string, { buffer: Buffer; contentType: string }>() }));
vi.mock('../lib/vercelBlob/vercelBlobStorageProvider', () => ({
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

const { extractArrangementPage, getArrangementExtractsState, extractPdfPage, extractCrematoryFormAfterCaseChange } = await import('./arrangementPageExtractService');
const { upload } = await import('./documentService');
const { caseFixtures } = await import('./__mocks__/fixtures');
const { caseDocumentFixtures } = await import('./__mocks__/documentFixtures');
const { activityEventFixtures } = await import('./__mocks__/activityEventFixtures');
const { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } = await import('./__mocks__/organizationIds');
import type { Case } from '@/types/case';

const CASE_ID = '1042';
const index = caseFixtures.findIndex((c) => c.id === CASE_ID && c.organizationId === DEFAULT_ORGANIZATION_ID);
const original: Case = caseFixtures[index];
const ctx = (actorIdentityId = 'staff-dana', organizationId = DEFAULT_ORGANIZATION_ID) => ({ organizationId, actorIdentityId, actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-x' });

// A tiny opaque PNG standing in for a signature image.
const SIGNATURE_PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

/** A fictional Arrangement Forms PDF: page n says "PAGE n — <label>", and
    every page carries the same "signature" image. */
async function arrangementPdf(pages: number, label = 'first') {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const signature = await doc.embedPng(SIGNATURE_PNG);
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`PAGE ${n} — ${label}`, { x: 72, y: 700, size: 14, font });
    page.drawText('Juniper Fairweather (fictional)', { x: 72, y: 680, size: 11, font });
    page.drawImage(signature, { x: 72, y: 600, width: 120, height: 40 });
  }
  return Buffer.from(await doc.save());
}

async function storeArrangement(bytes: Buffer, documentId: string) {
  return upload(
    { caseId: CASE_ID, fileName: 'Arrangement Forms.pdf', mimeType: 'application/pdf', documentTypeKey: 'external_form.arrangement_forms', idFactory: () => documentId },
    bytes,
    ctx(),
    'mock',
  );
}

/** pdf-lib needs a plain Uint8Array under the test environment. */
const loadPdf = (bytes: Uint8Array) => PDFDocument.load(new Uint8Array(bytes));

/** The decoded drawing instructions of a page — what is on it. */
async function pageContent(page: PDFPage) {
  const contents = page.node.Contents();
  const streams = contents && 'asArray' in contents ? contents.asArray() : [contents];
  return streams
    .map((ref) => page.doc.context.lookup(ref as never) as PDFRawStream)
    .map((stream) => Buffer.from(stream.getContents()).toString('latin1'))
    .join('\n');
}
/** Which page of `source` the single page of `extracted` is, by exact
    content (0 when it matches none). */
async function sourcePageOf(extracted: Uint8Array, source: Uint8Array) {
  const page = (await loadPdf(extracted)).getPage(0);
  const content = await pageContent(page);
  const pages = (await loadPdf(source)).getPages();
  for (let i = 0; i < pages.length; i++) if ((await pageContent(pages[i])) === content) return i + 1;
  return 0;
}
async function imageBytes(page: PDFPage) {
  const xobjects = page.node.Resources()!.lookup(PDFName.of('XObject')) as unknown as { entries(): [PDFName, unknown][] };
  return xobjects.entries().map(([, ref]) => Buffer.from((page.doc.context.lookup(ref as never) as PDFRawStream).getContents()).toString('hex'));
}

let lengths = { documents: 0, activity: 0 };
beforeEach(() => {
  lengths = { documents: caseDocumentFixtures.length, activity: activityEventFixtures.length };
  caseFixtures[index] = { ...original, isMedicalExaminerCase: true, isDeleted: false, slaEvents: {}, checklistState: {} };
});
afterEach(() => {
  caseFixtures[index] = original;
  caseDocumentFixtures.length = lengths.documents;
  activityEventFixtures.length = lengths.activity;
  blobs.clear();
});

const saved = (type: string) => caseDocumentFixtures.filter((d) => d.documentTypeKey === type).sort((a, b) => Number(a.version) - Number(b.version));
const events = () => activityEventFixtures.slice(lengths.activity).filter((e) => e.caseId === CASE_ID && e.category === 'documents');

describe('extractPdfPage', () => {
  it('copies exactly one page — its drawing instructions and images unchanged — and is repeatable byte for byte', async () => {
    const source = await arrangementPdf(6);
    const { bytes, sourcePageCount } = await extractPdfPage(new Uint8Array(source), 3);
    expect(sourcePageCount).toBe(6);
    const out = await loadPdf(bytes);
    const src = await loadPdf(source);
    expect(out.getPageCount()).toBe(1);
    expect(await pageContent(out.getPage(0))).toBe(await pageContent(src.getPage(2)));
    expect(await sourcePageOf(bytes, source)).toBe(3);
    expect(await imageBytes(out.getPage(0))).toEqual(await imageBytes(src.getPage(2)));
    expect(out.getPage(0).getSize()).toEqual(src.getPage(2).getSize());
    const again = await extractPdfPage(new Uint8Array(source), 3);
    expect(Buffer.from(again.bytes).equals(Buffer.from(bytes))).toBe(true);
  });

  it('refuses a source that is too short or not a PDF, creating nothing', async () => {
    await expect(extractPdfPage(new Uint8Array(await arrangementPdf(2)), 3)).rejects.toMatchObject({ status: 422, message: expect.stringContaining('has 2 pages, so page 3 cannot be extracted') });
    await expect(extractPdfPage(new Uint8Array(Buffer.from('not a pdf')), 2)).rejects.toMatchObject({ status: 422 });
  });
});

describe('Release Form (page 2)', () => {
  it('saves page 2 as "Release Form", one page, the Arrangement Form untouched', async () => {
    const sourceBytes = await arrangementPdf(6);
    const source = await storeArrangement(sourceBytes, 'arr-1');
    const sourceBefore = JSON.stringify(caseDocumentFixtures.find((d) => d.id === 'arr-1'));

    const { outcome, document } = await extractArrangementPage('me_form', CASE_ID, {}, ctx(), 'mock');
    expect(outcome).toBe('saved');
    expect(document).toMatchObject({ fileName: 'Release Form.pdf', mimeType: 'application/pdf', documentTypeKey: 'external_form.me_form', origin: 'generated', status: 'active', version: 1, generatedBy: 'staff-dana' });
    const out = await loadPdf(blobs.get(document.storageKey)!.buffer);
    expect(out.getPageCount()).toBe(1);
    expect(await sourcePageOf(blobs.get(document.storageKey)!.buffer, sourceBytes)).toBe(2);

    expect(JSON.stringify(caseDocumentFixtures.find((d) => d.id === 'arr-1'))).toBe(sourceBefore);
    expect(blobs.get(source.storageKey)!.buffer.equals(sourceBytes)).toBe(true);
    expect(events().map((e) => e.eventType)).toEqual(expect.arrayContaining(['document.generated', 'document.page_extracted']));
    expect(events().find((e) => e.eventType === 'document.page_extracted')!.description).toBe('Release Form v1 extracted from page 2 of the Arrangement Forms');
  });

  it('is only for Medical Examiner cases', async () => {
    await storeArrangement(await arrangementPdf(6), 'arr-1');
    caseFixtures[index] = { ...caseFixtures[index], isMedicalExaminerCase: false };
    await expect(extractArrangementPage('me_form', CASE_ID, {}, ctx(), 'mock')).rejects.toMatchObject({ status: 422, message: expect.stringContaining('Medical Examiner') });
    expect(saved('external_form.me_form')).toHaveLength(0);
  });
});

describe('Crematory Form (page 3)', () => {
  it('needs the permit confirmed — by the case data, or by staff — and records which', async () => {
    const sourceBytes = await arrangementPdf(6);
    await storeArrangement(sourceBytes, 'arr-1');
    await expect(extractArrangementPage('crematory_form', CASE_ID, {}, ctx(), 'mock')).rejects.toMatchObject({ status: 428 });
    expect(saved('external_form.crematory_form')).toHaveLength(0);

    const { document } = await extractArrangementPage('crematory_form', CASE_ID, { permitVerifiedByStaff: true }, ctx(), 'mock');
    expect(document).toMatchObject({ fileName: 'Crematory Form.pdf', version: 1 });
    expect(await sourcePageOf(blobs.get(document.storageKey)!.buffer, sourceBytes)).toBe(3);
    expect(events().find((e) => e.eventType === 'document.page_extracted')!.description).toBe('Crematory Form v1 extracted from page 3 of the Arrangement Forms (permit: verified by staff)');
  });

  it('a recorded state approval confirms the permit without staff confirmation', async () => {
    await storeArrangement(await arrangementPdf(6), 'arr-1');
    caseFixtures[index] = { ...caseFixtures[index], slaEvents: { approval_received: { at: '2026-10-26T15:00:00.000Z', recordedAt: '2026-10-26T15:00:00.000Z', recordedBy: 'staff-dana', source: 'staff' } } } as Case;
    await extractArrangementPage('crematory_form', CASE_ID, {}, ctx(), 'mock');
    expect(events().find((e) => e.eventType === 'document.page_extracted')!.description).toContain('(permit: State approval recorded)');
  });
});

describe('versions and duplicates', () => {
  it('extracting again from the same Arrangement Form creates nothing; an updated Arrangement Form makes v2 and keeps v1', async () => {
    await storeArrangement(await arrangementPdf(6, 'first'), 'arr-1');
    const v1 = (await extractArrangementPage('me_form', CASE_ID, {}, ctx(), 'mock')).document;
    const v1Bytes = Buffer.from(blobs.get(v1.storageKey)!.buffer);
    expect((await extractArrangementPage('me_form', CASE_ID, {}, ctx(), 'mock')).outcome).toBe('unchanged');
    expect(saved('external_form.me_form')).toHaveLength(1);

    // A corrected Arrangement Form arrives later (newer createdAt).
    await new Promise((resolve) => setTimeout(resolve, 5));
    const corrected = await arrangementPdf(6, 'corrected');
    await storeArrangement(corrected, 'arr-2');
    const v2 = (await extractArrangementPage('me_form', CASE_ID, {}, ctx('staff-lee'), 'mock')).document;
    expect(v2).toMatchObject({ version: 2, supersedesId: v1.id, generatedBy: 'staff-lee' });
    expect(saved('external_form.me_form').map((d) => [d.version, d.status])).toEqual([
      [1, 'superseded'],
      [2, 'active'],
    ]);
    expect(blobs.get(v1.storageKey)!.buffer.equals(v1Bytes)).toBe(true);
    expect(await sourcePageOf(blobs.get(v2.storageKey)!.buffer, corrected)).toBe(2);
    expect(createHash('sha256').update(blobs.get(v2.storageKey)!.buffer).digest('hex')).toBe(v2.checksumSha256);
  });
});

describe('refusals', () => {
  it('no Arrangement Form, or one too short: a clear error and nothing created', async () => {
    await expect(extractArrangementPage('me_form', CASE_ID, {}, ctx(), 'mock')).rejects.toMatchObject({ status: 422, message: 'This case has no Arrangement Form PDF yet, so nothing was extracted.' });
    await storeArrangement(await arrangementPdf(2), 'arr-short');
    await expect(extractArrangementPage('crematory_form', CASE_ID, { permitVerifiedByStaff: true }, ctx(), 'mock')).rejects.toMatchObject({ status: 422 });
    expect(saved('external_form.crematory_form')).toHaveLength(0);
  });

  it('an archived case, and an organization without these forms, are refused', async () => {
    await storeArrangement(await arrangementPdf(6), 'arr-1');
    caseFixtures[index] = { ...caseFixtures[index], isDeleted: true };
    await expect(extractArrangementPage('me_form', CASE_ID, {}, ctx(), 'mock')).rejects.toMatchObject({ status: 409 });
    await expect(extractArrangementPage('me_form', CASE_ID, {}, ctx('staff-x', SECOND_MOCK_ORGANIZATION_ID), 'mock')).rejects.toMatchObject({ status: 404 });
  });
});

describe('getArrangementExtractsState', () => {
  it('reports the source, the ME flag, the permit and the latest saved copies', async () => {
    expect(await getArrangementExtractsState(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock')).toMatchObject({ source: null, isMedicalExaminerCase: true, permit: { confirmed: false }, latest: { me_form: null, crematory_form: null } });
    await storeArrangement(await arrangementPdf(6), 'arr-1');
    const { document } = await extractArrangementPage('me_form', CASE_ID, {}, ctx(), 'mock');
    expect(await getArrangementExtractsState(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock')).toMatchObject({
      source: { documentId: 'arr-1', fileName: 'Arrangement Forms.pdf' },
      latest: { me_form: { documentId: document.id, version: 1 }, crematory_form: null },
    });
  });
});

describe('automatic Crematory Form (2026-10)', () => {
  /** Case 1042 with a Manors-shaped workflow 2 and 3 and the given ticks. */
  function withWorkflow(checklistState: Record<string, boolean>): Case {
    const base = caseFixtures[index];
    const stage = base.workflowSnapshot!.stages[0];
    const item = (i: number, label: string) => ({ ...stage.checklist.items[0], index: i, label, hasField: false, requiredCaseFields: undefined });
    return {
      ...base,
      isMedicalExaminerCase: false,
      checklistState,
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

  it('checking the last step of workflow 2 (permit still pending) saves the Crematory Form, attributed and audited', async () => {
    const sourceBytes = await arrangementPdf(6);
    await storeArrangement(sourceBytes, 'arr-1');
    const before = withWorkflow({ '2:0': true, '2:1': true });
    const after = withWorkflow({ '2:0': true, '2:1': true, '2:2': true });
    caseFixtures[index] = after;

    expect(await extractCrematoryFormAfterCaseChange(before, after, ctx('staff-lee'), 'mock')).toBe('generated');
    const [form] = saved('external_form.crematory_form');
    expect(form).toMatchObject({ fileName: 'Crematory Form.pdf', version: 1, generatedBy: 'staff-lee' });
    expect(await sourcePageOf(blobs.get(form.storageKey)!.buffer, sourceBytes)).toBe(3);
    expect(events().find((e) => e.eventType === 'document.page_extracted')!.description).toBe(
      'Crematory Form v1 extracted from page 3 of the Arrangement Forms (permit: "Attestation Received / Hard Saved" checked)',
    );
  });

  it('other saves create nothing — before that moment, while it holds, or once the permit step is checked', async () => {
    await storeArrangement(await arrangementPdf(6), 'arr-1');
    const ready = withWorkflow({ '2:2': true });
    caseFixtures[index] = ready;
    expect(await extractCrematoryFormAfterCaseChange(withWorkflow({}), withWorkflow({ '2:0': true }), ctx(), 'mock')).toBe('not_applicable');
    expect(await extractCrematoryFormAfterCaseChange(ready, withWorkflow({ '2:2': true, '0:1': true }), ctx(), 'mock')).toBe('not_applicable');
    expect(await extractCrematoryFormAfterCaseChange(ready, withWorkflow({ '2:2': true, '3:0': true }), ctx(), 'mock')).toBe('not_applicable');
    expect(saved('external_form.crematory_form')).toHaveLength(0);
  });

  it('with no Arrangement Form yet, reports it and creates nothing — never throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const after = withWorkflow({ '2:2': true });
    caseFixtures[index] = after;
    expect(await extractCrematoryFormAfterCaseChange(withWorkflow({}), after, ctx(), 'mock')).toBe('missing_source');
    expect(saved('external_form.crematory_form')).toHaveLength(0);
  });

  it('a Crematory Form already extracted from the same Arrangement Form is not duplicated', async () => {
    await storeArrangement(await arrangementPdf(6), 'arr-1');
    const after = withWorkflow({ '2:2': true });
    caseFixtures[index] = after;
    await extractArrangementPage('crematory_form', CASE_ID, { permitVerifiedByStaff: true }, ctx(), 'mock');
    expect(await extractCrematoryFormAfterCaseChange(withWorkflow({}), after, ctx(), 'mock')).toBe('unchanged');
    expect(saved('external_form.crematory_form')).toHaveLength(1);
  });

  it('never for another organization', async () => {
    const after = { ...withWorkflow({ '2:2': true }), organizationId: SECOND_MOCK_ORGANIZATION_ID };
    expect(await extractCrematoryFormAfterCaseChange(null, after, ctx('staff-x', SECOND_MOCK_ORGANIZATION_ID), 'mock')).toBe('not_applicable');
  });
});
