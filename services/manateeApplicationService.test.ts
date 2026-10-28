import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import type { ExternalFormSubmission } from '@/types/externalFormSubmission';
import type { Case } from '@/types/case';

/**
 * Manatee County — Death Certificate Application (2026-10). The real
 * service and case-document pipeline in mock mode: intake-form answers come
 * from a stand-in for Jotform, document storage is in memory, and every
 * person and number is fictional (000-xx-xxxx SSNs are never issued).
 */
const { blobs, answersBySubmission, submissions } = vi.hoisted(() => ({
  blobs: new Map<string, { buffer: Buffer; contentType: string }>(),
  answersBySubmission: new Map<string, Record<string, { answer: unknown }>>(),
  submissions: [] as ExternalFormSubmission[],
}));
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
vi.mock('@/lib/jotform/jotformClient', () => ({
  fetchSubmissionAnswers: vi.fn(async (id: string) => {
    const answers = answersBySubmission.get(id);
    if (!answers) throw new Error('Jotform said no for 000-12-3456');
    return { formId: 'x', submittedAt: null, answers };
  }),
}));
vi.mock('./externalForms/caseSubmissions', () => ({ listCaseSubmissionsNewestFirst: vi.fn(async () => [...submissions]) }));

const { getManateeApplicationDraft, previewManateeApplication, saveManateeApplication } = await import('./manateeApplicationService');
const { list } = await import('./documentService');
const { caseFixtures } = await import('./__mocks__/fixtures');
const { caseDocumentFixtures } = await import('./__mocks__/documentFixtures');
const { activityEventFixtures } = await import('./__mocks__/activityEventFixtures');
const { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } = await import('./__mocks__/organizationIds');
const { buildManateeTemplateFixture, drawnTexts } = await import('./__mocks__/manateeTemplateFixture');
const { ARRANGEMENT_FORMS_EXTERNAL_FORM_ID, VITAL_STATISTICS_EXTERNAL_FORM_ID } = await import('@/domain/externalForms/fieldMapping');
const { DOCUMENT_TYPES } = await import('@/domain/documents/documentTypeRegistry');

const CASE_ID = '1042';
const index = caseFixtures.findIndex((c) => c.id === CASE_ID && c.organizationId === DEFAULT_ORGANIZATION_ID);
const original: Case = caseFixtures[index];
const ctx = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'staff-dana', actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-m' };

const submission = (id: string, externalFormId: string, receivedAt: string): ExternalFormSubmission =>
  ({ id, organizationId: DEFAULT_ORGANIZATION_ID, provider: 'jotform', externalFormId, externalSubmissionId: id, receivedAt, mappedFields: '{}' }) as unknown as ExternalFormSubmission;

const arrangementAnswers = {
  '87': { answer: { first: 'Mary Ann', middle: 'Louise', last: 'Salas Rueda', suffix: '' } },
  '11': { answer: '000-12-3456' },
  '97': { answer: { addr_line1: '100 Example St', city: 'Pembroke Pines', state: 'Florida', postal: '33000' } },
  '105': { answer: { first: 'Jonathan', middle: '', last: 'Salas Rueda' } },
};

let templateDir: string;
beforeAll(async () => {
  templateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manatee-'));
  await fs.writeFile(path.join(templateDir, 'template.pdf'), await buildManateeTemplateFixture());
});
afterAll(() => fs.rm(templateDir, { recursive: true, force: true }));

beforeEach(() => {
  vi.stubEnv('MANATEE_DC_APPLICATION_TEMPLATE_STORAGE_KEY', '');
  vi.stubEnv('MANATEE_DC_APPLICATION_TEMPLATE_PATH', path.join(templateDir, 'template.pdf'));
  submissions.length = 0;
  answersBySubmission.clear();
  submissions.push(submission('sub-arr', ARRANGEMENT_FORMS_EXTERNAL_FORM_ID, '2026-10-05T10:00:00.000Z'));
  answersBySubmission.set('sub-arr', arrangementAnswers);
  caseFixtures[index] = {
    ...original,
    decedentName: 'MARY ANN LOUISE SALAS RUEDA',
    dateOfDeath: '10/04/2026',
    nextOfKinName: 'TERESA SALAS RUEDA',
    nextOfKinRelationship: 'daughter',
    nextOfKinRelationshipOther: null,
    isDeleted: false,
  };
});
afterEach(() => {
  caseFixtures[index] = original;
  caseDocumentFixtures.length = 0;
  activityEventFixtures.length = 0;
  vi.unstubAllEnvs();
});

const reviewed = (overrides: Record<string, unknown> = {}) => ({
  decedentFirst: 'Mary Ann',
  decedentMiddle: 'Louise',
  decedentLast: 'Salas Rueda',
  ssnNotKnown: false,
  dateOfDeath: '10/04/2026',
  placeOfDeathCity: 'Pembroke Pines',
  placeOfDeathCounty: 'BROWARD',
  spouseFirst: 'Jonathan',
  spouseMiddle: '',
  spouseLast: 'Salas Rueda',
  representedName: 'TERESA SALAS RUEDA',
  representedRelationship: 'Daughter',
  withCause: 2,
  withoutCause: 0,
  fedexFee: false,
  requestNumber: '',
  requestOf: '',
  ...overrides,
});

/** The saved form is flattened: read what it draws. */
const textsOf = (bytes: Uint8Array) => drawnTexts(bytes);

describe('the draft staff review', () => {
  it('fills everything it can from the Arrangement Form and the case, and never sends the SSN to the browser', async () => {
    const draft = await getManateeApplicationDraft(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock');
    expect(draft.values).toMatchObject({
      decedentFirst: 'Mary Ann',
      decedentMiddle: 'Louise',
      decedentLast: 'Salas Rueda',
      dateOfDeath: '10/04/2026',
      placeOfDeathCity: 'Pembroke Pines',
      // No record of the county anywhere — staff enter it; never inferred from the city.
      placeOfDeathCounty: '',
      spouseFirst: 'Jonathan',
      spouseLast: 'Salas Rueda',
      representedName: 'TERESA SALAS RUEDA',
      representedRelationship: 'Daughter',
      withCause: 0,
      withoutCause: 0,
      fedexFee: false,
    });
    expect(draft.sources).toMatchObject({ decedentFirst: 'arrangement_form', placeOfDeathCounty: null, dateOfDeath: 'case', representedRelationship: 'case' });
    expect(draft.ssn).toEqual({ onFile: true, masked: '•••-••-3456', source: 'arrangement_form' });
    expect(JSON.stringify(draft)).not.toMatch(/000-?12-?3456|000123456/);
    expect(draft.template).toBe('available');
    // Only the county and the quantities are left for staff.
    expect(draft.issues.map((i) => i.message)).toEqual(['Enter the county of death.', 'Order at least one death certificate.']);
  });

  it('never splits a full name: with no form, first and last are left for staff', async () => {
    submissions.length = 0;
    const draft = await getManateeApplicationDraft(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock');
    expect(draft.values.decedentFirst).toBe('');
    expect(draft.values.decedentLast).toBe('');
    expect(draft.ssn.onFile).toBe(false);
    expect(draft.issues.map((i) => i.field)).toEqual(expect.arrayContaining(['decedentFirst', 'decedentLast', 'ssn', 'placeOfDeathCity', 'placeOfDeathCounty']));
  });

  it('prefers the Arrangement Form, and fills gaps from the Vital Statistics form', async () => {
    answersBySubmission.set('sub-arr', { ...arrangementAnswers, '11': { answer: '' }, '105': { answer: { first: '', last: '' } } });
    submissions.push(submission('sub-vs', VITAL_STATISTICS_EXTERNAL_FORM_ID, '2026-10-06T10:00:00.000Z'));
    answersBySubmission.set('sub-vs', { '3': { answer: { first: 'Other', last: 'Name' } }, '7': { answer: '000987654' }, '14': { answer: { first: 'Jon', last: 'Rueda' } } });
    const draft = await getManateeApplicationDraft(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock');
    expect(draft.values.decedentFirst).toBe('Mary Ann');
    expect(draft.ssn).toEqual({ onFile: true, masked: '•••-••-7654', source: 'vital_statistics' });
    expect([draft.values.spouseFirst, draft.values.spouseLast]).toEqual(['Jon', 'Rueda']);
  });

  it('keeps SOLIS relationships the form has no list entry for — Legal Representative, Domestic Partner, Friend', async () => {
    for (const [relationship, expected] of [['legal_representative', 'Legal Representative'], ['domestic_partner', 'Domestic Partner'], ['friend', 'Friend']] as const) {
      caseFixtures[index] = { ...caseFixtures[index], nextOfKinRelationship: relationship };
      expect((await getManateeApplicationDraft(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock')).values.representedRelationship).toBe(expected);
    }
  });

  it('a relationship the form cannot state without a guess is left for staff', async () => {
    caseFixtures[index] = { ...caseFixtures[index], nextOfKinRelationship: 'parent' };
    const draft = await getManateeApplicationDraft(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock');
    expect(draft.values.representedRelationship).toBe('');
    expect(draft.issues.map((i) => i.field)).toContain('representedRelationship');
  });

  it('a Jotform failure only leaves values for staff — and its message is never passed on', async () => {
    answersBySubmission.clear();
    const draft = await getManateeApplicationDraft(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock');
    expect(draft.ssn.onFile).toBe(false);
    expect(JSON.stringify(draft)).not.toContain('3456');
  });

  it('reports the form as not set up when no template is configured', async () => {
    vi.stubEnv('MANATEE_DC_APPLICATION_TEMPLATE_PATH', '');
    expect((await getManateeApplicationDraft(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock')).template).toBe('not_configured');
  });

  it('is Manors only, and never another organization\'s case', async () => {
    await expect(getManateeApplicationDraft(SECOND_MOCK_ORGANIZATION_ID, CASE_ID, 'mock')).rejects.toMatchObject({ status: 404 });
    await expect(getManateeApplicationDraft(DEFAULT_ORGANIZATION_ID, 'no-such-case', 'mock')).rejects.toMatchObject({ status: 404 });
  });
});

describe('preview and save', () => {
  it('the preview is the filled form, using the SSN on file — and stores nothing', async () => {
    const texts = await textsOf(await previewManateeApplication(DEFAULT_ORGANIZATION_ID, CASE_ID, reviewed(), 'mock'));
    expect(texts).toEqual(expect.arrayContaining(['000-12-3456', 'SALAS RUEDA', 'BROWARD']));
    expect(texts.filter((t) => t === '16.00')).toHaveLength(2); // the line total and the grand total
    expect(caseDocumentFixtures).toHaveLength(0);
  });

  it('a number staff typed is used instead; "not known" leaves the box blank', async () => {
    const typed = await textsOf(await previewManateeApplication(DEFAULT_ORGANIZATION_ID, CASE_ID, reviewed({ ssn: '000-55-1111' }), 'mock'));
    expect(typed).toContain('000-55-1111');
    expect(typed).not.toContain('000-12-3456');
    const notKnown = await textsOf(await previewManateeApplication(DEFAULT_ORGANIZATION_ID, CASE_ID, reviewed({ ssnNotKnown: true }), 'mock'));
    expect(notKnown.some((t) => /\d{3}-\d{2}-\d{4}/.test(t))).toBe(false);
  });

  it('refuses incomplete values (422) — never a form with fabricated information', async () => {
    await expect(previewManateeApplication(DEFAULT_ORGANIZATION_ID, CASE_ID, reviewed({ representedRelationship: '' }), 'mock')).rejects.toMatchObject({ status: 422 });
    submissions.length = 0;
    await expect(previewManateeApplication(DEFAULT_ORGANIZATION_ID, CASE_ID, reviewed(), 'mock')).rejects.toMatchObject({
      status: 422,
      message: 'Enter the 9-digit Social Security number, or mark it as not known.',
    });
  });

  it('saves to the case documents, versioned and audited — and leaves the case unchanged', async () => {
    const before = structuredClone(caseFixtures[index]);
    const first = await saveManateeApplication(DEFAULT_ORGANIZATION_ID, CASE_ID, reviewed(), ctx, 'mock');
    const second = await saveManateeApplication(DEFAULT_ORGANIZATION_ID, CASE_ID, reviewed({ withoutCause: 1, fedexFee: true }), ctx, 'mock');

    expect(first.fileName).toBe('Manatee County Death Certificate Application.pdf');
    expect(first.documentTypeKey).toBe(DOCUMENT_TYPES.VITAL_RECORDS_MANATEE_DEATH_CERTIFICATE_APPLICATION.key);
    expect(first.mimeType).toBe('application/pdf');
    const documents = await list(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock');
    expect(documents.find((d) => d.id === first.id)?.status).toBe('superseded');
    expect(documents.find((d) => d.id === second.id)?.status).toBe('active');
    expect(Number(second.version)).toBe(Number(first.version) + 1);
    expect(activityEventFixtures.some((e) => e.resourceId === second.id)).toBe(true);
    // Nothing about the SSN in the file name or the audit trail.
    expect(JSON.stringify(activityEventFixtures)).not.toMatch(/000-?12-?3456/);
    expect(caseFixtures[index]).toEqual(before);

    // The saved file is locked (flattened) and carries the corrected values:
    // 2 + 1 certificates, FedEx 1 × 15.00, grand total 39.00.
    const stored = new Uint8Array(blobs.get(documents.find((d) => d.id === second.id)!.storageKey)!.buffer);
    expect((await PDFDocument.load(stored)).getForm().getFields()).toHaveLength(0);
    expect(await textsOf(stored)).toEqual(expect.arrayContaining(['8.00', '15.00', '39.00']));
    // The earlier version is kept in History, unchanged: no FedEx, 16.00.
    const earlier = new Uint8Array(blobs.get(documents.find((d) => d.id === first.id)!.storageKey)!.buffer);
    expect(await textsOf(earlier)).not.toContain('15.00');
  });

  it('the template unavailable is a clear 503, not a failure', async () => {
    vi.stubEnv('MANATEE_DC_APPLICATION_TEMPLATE_PATH', '');
    await expect(saveManateeApplication(DEFAULT_ORGANIZATION_ID, CASE_ID, reviewed(), ctx, 'mock')).rejects.toMatchObject({ status: 503 });
    expect(caseDocumentFixtures).toHaveLength(0);
  });
});
