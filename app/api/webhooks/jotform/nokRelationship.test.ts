import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFormLinkFixtures, externalFormSubmissionFixtures } from '@/services/__mocks__/externalFormFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import type { Case } from '@/types/case';

/**
 * Next of Kin relationship from the Arrangement Forms (2026-10), end to end:
 * a fictional Arrangement submission reaches the webhook for an existing
 * Manors case whose relationship is blank (as every First Call case's is).
 * Jotform's API is faked; no real form or case is touched.
 */
const { submissionApiRecords } = vi.hoisted(() => ({
  submissionApiRecords: new Map<string, { formId: string; submittedAt: string | null; answers: Record<string, { answer: string | Record<string, string> }> }>(),
}));
vi.mock('@/lib/jotform/jotformClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jotform/jotformClient')>('@/lib/jotform/jotformClient');
  return {
    ...actual,
    fetchSubmissionPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 synthetic')),
    fetchSubmissionAnswers: vi.fn(async (submissionId: string) => {
      const record = submissionApiRecords.get(submissionId);
      if (!record) throw new actual.JotformClientError('Jotform submission retrieval failed with status 401.', 'http_error');
      return record;
    }),
  };
});
vi.mock('@/services/documentService', async () => {
  const actual = await vi.importActual<typeof import('@/services/documentService')>('@/services/documentService');
  return { ...actual, upload: vi.fn().mockResolvedValue({ id: 'document-webhook-test' }) };
});

const ARRANGEMENT_FORMS_FORM_ID = '261945978664175';
const ARRANGEMENT_LINK_QID = '274';
const CASE_ID = '1042';
const index = caseFixtures.findIndex((c) => c.id === CASE_ID && c.organizationId === 'managed-cremations');
const original: Case = caseFixtures[index];

const jotformTimestamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
function webhookRequest(fields: Record<string, string>) {
  return new Request('http://localhost/api/webhooks/jotform', {
    method: 'POST',
    body: new URLSearchParams(fields).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

let lengths = { links: 0, submissions: 0, activity: 0 };
beforeEach(() => {
  process.env.JOTFORM_API_KEY = 'test-api-key';
  lengths = { links: caseFormLinkFixtures.length, submissions: externalFormSubmissionFixtures.length, activity: activityEventFixtures.length };
  caseFixtures[index] = { ...original, nextOfKinName: 'CARLA FAIRWEATHER', nextOfKinPhone: '(555) 201-0000', nextOfKinRelationship: null, nextOfKinEmail: 'carla@example.test', isDeleted: false };
});
afterEach(() => {
  delete process.env.JOTFORM_API_KEY;
  submissionApiRecords.clear();
  caseFormLinkFixtures.length = lengths.links;
  externalFormSubmissionFixtures.length = lengths.submissions;
  activityEventFixtures.length = lengths.activity;
  caseFixtures[index] = original;
  vi.clearAllMocks();
});

/** A fictional Arrangement Form: Informant is the Next of Kin (qid 276 = Yes). */
async function deliver(submissionId: string, answers: Record<string, string | Record<string, string>>) {
  const { generateLinkForSending } = await import('@/services/caseFormLinkService');
  const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
  const { rawToken } = await generateLinkForSending('managed-cremations', CASE_ID, 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');
  const wrapped: Record<string, { answer: string | Record<string, string> }> = {};
  for (const [qid, value] of Object.entries({ [ARRANGEMENT_LINK_QID]: rawToken, ...answers })) wrapped[qid] = { answer: value };
  submissionApiRecords.set(submissionId, { formId: ARRANGEMENT_FORMS_FORM_ID, submittedAt: jotformTimestamp(), answers: wrapped });
  const { POST } = await import('./route');
  const response = await POST(webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: submissionId }));
  expect(response.status).toBe(200);
}

const informantIsNok = (relationship: string, name = { first: 'Carla', last: 'Fairweather' }) => ({
  '122': name,
  '224': { full: '(555) 201-0000' },
  '225': relationship,
  '276': 'Yes',
});
const current = () => caseFixtures[index];
const events = (type: string) => activityEventFixtures.slice(lengths.activity).filter((e) => e.caseId === CASE_ID && e.eventType === type);

describe('Arrangement Form → Next of Kin relationship (webhook)', () => {
  it('fills the blank relationship with the matching SOLIS option, and touches nothing else', async () => {
    const before = { ...current() };
    await deliver('2000000000000000001', informantIsNok('Daughter'));
    expect(current().nextOfKinRelationship).toBe('daughter');
    // Other Next of Kin fields and the rest of the case are unchanged.
    expect(current()).toMatchObject({ nextOfKinName: before.nextOfKinName, nextOfKinPhone: before.nextOfKinPhone, nextOfKinEmail: before.nextOfKinEmail, decedentName: before.decedentName });
    expect(events('external_form.fields_applied').map((e) => e.description)).toEqual(['Applied from external form: nextOfKinRelationship']);
  });

  it('maps every option the form offers, including "Legal Representative"', async () => {
    const cases: Array<[string, string]> = [
      ['Spouse', 'spouse'],
      ['Mother', 'parent'],
      ['Father', 'parent'],
      ['Son', 'son'],
      ['Brother', 'brother'],
      ['Sister', 'sister'],
      ['Granddaughter', 'grandchild'],
      ['Legal Representative', 'legal_representative'],
      ['Other', 'other'],
    ];
    let n = 10;
    for (const [submitted, expected] of cases) {
      caseFixtures[index] = { ...current(), nextOfKinRelationship: null };
      await deliver(`20000000000000000${n++}`, informantIsNok(submitted));
      expect(current().nextOfKinRelationship).toBe(expected);
    }
  });

  it('the "No" path takes the dedicated Next of Kin (qids 277-279)', async () => {
    await deliver('2000000000000000002', {
      '122': { first: 'Informant', last: 'Person' },
      '225': 'Friend-of-family',
      '276': 'No',
      '277': { first: 'Carla', last: 'Fairweather' },
      '278': { full: '(555) 201-0000' },
      '279': 'Sister',
    });
    expect(current().nextOfKinRelationship).toBe('sister');
  });

  it('an existing (manually corrected) relationship is never overwritten by a duplicate or late submission', async () => {
    caseFixtures[index] = { ...current(), nextOfKinRelationship: 'son' };
    await deliver('2000000000000000003', informantIsNok('Daughter'));
    expect(current().nextOfKinRelationship).toBe('son');
    expect(events('external_form.fields_applied')).toHaveLength(0);
  });

  it('an unknown value is kept on the submission and flagged — never guessed', async () => {
    await deliver('2000000000000000004', informantIsNok('Cousin'));
    expect(current().nextOfKinRelationship).toBeNull();
    const stored = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === '2000000000000000004')!;
    expect(JSON.parse(stored.mappedFields)).toMatchObject({ nextOfKinRelationshipSource: 'Cousin' });
    expect(JSON.parse(stored.mappedFields).nextOfKinRelationship).toBeUndefined();
    expect(events('external_form.nok_relationship_review')[0].description).toBe(
      'Arrangement Form Next of Kin relationship "Cousin" was not filled in: it does not match any SOLIS relationship option. Review and choose the relationship on the case.',
    );
  });

  it("a relationship for a different person than the case's Next of Kin is not attached to the case's contact", async () => {
    await deliver('2000000000000000005', informantIsNok('Brother', { first: 'Theo', last: 'Fairweather' }));
    expect(current().nextOfKinRelationship).toBeNull();
    expect(events('external_form.nok_relationship_review')[0].description).toContain("the form's Next of Kin is not the same person as the case's Next of Kin");
  });

  it('a blank relationship leaves the manual workflow as it is', async () => {
    await deliver('2000000000000000006', { '122': { first: 'Carla', last: 'Fairweather' }, '276': 'Yes' });
    expect(current().nextOfKinRelationship).toBeNull();
    expect(events('external_form.nok_relationship_review')).toHaveLength(0);
    expect(events('external_form.fields_applied')).toHaveLength(0);
  });
});
