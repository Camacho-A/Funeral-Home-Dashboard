import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalFormSubmission } from '@/types/externalFormSubmission';
import type { Case } from '@/types/case';

/**
 * Case SSN (2026-10): captured from the Arrangement Form (else Vital
 * Statistics), encrypted, locked; corrected only by an administrator.
 * Mock mode, Jotform simulated, fictional numbers (000-xx-xxxx is never issued).
 */
const { answersBySubmission, submissions } = vi.hoisted(() => ({
  answersBySubmission: new Map<string, Record<string, { answer: unknown }>>(),
  submissions: [] as ExternalFormSubmission[],
}));
vi.mock('@/lib/jotform/jotformClient', () => ({
  fetchSubmissionAnswers: vi.fn(async (id: string) => {
    const answers = answersBySubmission.get(id);
    if (!answers) throw new Error('Jotform said no for 000-12-3456');
    return { formId: 'x', submittedAt: null, answers };
  }),
}));
vi.mock('./externalForms/caseSubmissions', () => ({ listCaseSubmissionsNewestFirst: vi.fn(async () => [...submissions]) }));

const svc = await import('./caseSsnService');
const { caseFixtures } = await import('./__mocks__/fixtures');
const { activityEventFixtures } = await import('./__mocks__/activityEventFixtures');
const { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } = await import('./__mocks__/organizationIds');
const { ARRANGEMENT_FORMS_EXTERNAL_FORM_ID, VITAL_STATISTICS_EXTERNAL_FORM_ID } = await import('@/domain/externalForms/fieldMapping');

const CASE_ID = '1042';
const index = caseFixtures.findIndex((c) => c.id === CASE_ID && c.organizationId === DEFAULT_ORGANIZATION_ID);
const original: Case = caseFixtures[index];
const ctx = (actorIdentityId: string | null = 'identity-admin') => ({ organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId, actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-ssn' });
const submission = (id: string, externalFormId: string, receivedAt = '2026-10-05T10:00:00.000Z') =>
  ({ id, organizationId: DEFAULT_ORGANIZATION_ID, provider: 'jotform', externalFormId, externalSubmissionId: id, receivedAt, mappedFields: '{}' }) as unknown as ExternalFormSubmission;

beforeEach(() => {
  svc.resetMockCaseSsn();
  answersBySubmission.clear();
  submissions.length = 0;
  answersBySubmission.set('arr', { '11': { answer: '000123456' } });
  answersBySubmission.set('vs', { '7': { answer: '000-98-7654' } });
});
afterEach(() => {
  caseFixtures[index] = original;
  activityEventFixtures.length = 0;
  vi.unstubAllEnvs();
});

const noDigits = () => expect(JSON.stringify(activityEventFixtures)).not.toMatch(/000-?12-?3456|000123456|000-?98-?7654|000-?55-?1111/);

describe('capture', () => {
  it('saves the Arrangement Form\'s SSN, encrypted, with only its last four on the case', async () => {
    expect(await svc.captureCaseSsnFromSubmission(ctx(), CASE_ID, submission('arr', ARRANGEMENT_FORMS_EXTERNAL_FORM_ID), 'mock')).toBe('captured');
    expect(caseFixtures[index].ssnOnFile).toMatchObject({ last4: '3456', source: 'arrangement_form' });
    expect(JSON.stringify(caseFixtures[index])).not.toContain('123456');
    expect((await svc.readCaseSsn(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock'))?.ssn).toBe('000-12-3456');
    const event = activityEventFixtures.at(-1)!;
    expect(event.eventType).toBe('case.ssn_captured');
    noDigits();
  });

  it('is locked: a later or different form never replaces it', async () => {
    await svc.captureCaseSsnFromSubmission(ctx(), CASE_ID, submission('arr', ARRANGEMENT_FORMS_EXTERNAL_FORM_ID), 'mock');
    expect(await svc.captureCaseSsnFromSubmission(ctx(), CASE_ID, submission('vs', VITAL_STATISTICS_EXTERNAL_FORM_ID), 'mock')).toBe('already_on_file');
    expect((await svc.readCaseSsn(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock'))?.ssn).toBe('000-12-3456');
  });

  it('other forms, a missing or malformed answer, or a Jotform failure capture nothing', async () => {
    expect(await svc.captureCaseSsnFromSubmission(ctx(), CASE_ID, submission('x', 'some-other-form'), 'mock')).toBe('not_applicable');
    answersBySubmission.set('arr', { '11': { answer: '12345' } });
    expect(await svc.captureCaseSsnFromSubmission(ctx(), CASE_ID, submission('arr', ARRANGEMENT_FORMS_EXTERNAL_FORM_ID), 'mock')).toBe('none_found');
    answersBySubmission.clear();
    expect(await svc.captureCaseSsnFromSubmission(ctx(), CASE_ID, submission('arr', ARRANGEMENT_FORMS_EXTERNAL_FORM_ID), 'mock')).toBe('none_found');
    expect(caseFixtures[index].ssnOnFile ?? null).toBeNull();
  });

  it('for an older case, the first time it is needed: the Arrangement Form first, else Vital Statistics', async () => {
    submissions.push(submission('vs', VITAL_STATISTICS_EXTERNAL_FORM_ID, '2026-10-06T10:00:00.000Z'), submission('arr', ARRANGEMENT_FORMS_EXTERNAL_FORM_ID));
    expect(await svc.captureCaseSsnFromForms(ctx(), CASE_ID, 'mock')).toBe('captured');
    expect(caseFixtures[index].ssnOnFile).toMatchObject({ source: 'arrangement_form', last4: '3456' });
    svc.resetMockCaseSsn();
    caseFixtures[index] = original;
    answersBySubmission.delete('arr');
    expect(await svc.captureCaseSsnFromForms(ctx(), CASE_ID, 'mock')).toBe('captured');
    expect(caseFixtures[index].ssnOnFile).toMatchObject({ source: 'vital_statistics', last4: '7654' });
  });

  it('nothing is captured without its own encryption key in production, or for an organization without the feature', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SSN_ENCRYPTION_KEY', '');
    expect(await svc.captureCaseSsnFromSubmission(ctx(), CASE_ID, submission('arr', ARRANGEMENT_FORMS_EXTERNAL_FORM_ID), 'mock')).toBe('not_applicable');
    vi.unstubAllEnvs();
    expect(svc.caseSsnEnabled(SECOND_MOCK_ORGANIZATION_ID)).toBe(false);
  });
});

describe('administrator correction', () => {
  it('replaces the locked SSN, keeps when it was first captured, and records the reason — never the number', async () => {
    await svc.captureCaseSsnFromSubmission(ctx(), CASE_ID, submission('arr', ARRANGEMENT_FORMS_EXTERNAL_FORM_ID), 'mock');
    const firstCaptured = caseFixtures[index].ssnOnFile!.capturedAt;
    const summary = await svc.correctCaseSsn(ctx(), CASE_ID, { ssn: '000-55-1111', reason: 'Typo on the Arrangement Form' }, 'mock');
    expect(summary).toMatchObject({ last4: '1111', source: 'admin_correction', capturedAt: firstCaptured });
    expect(summary.correctedAt).toBeTruthy();
    expect((await svc.readCaseSsn(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock'))?.ssn).toBe('000-55-1111');
    const event = activityEventFixtures.at(-1)!;
    expect(event.eventType).toBe('case.ssn_corrected');
    expect(event.description).toContain('Typo on the Arrangement Form');
    noDigits();
  });

  it('refuses a malformed number', async () => {
    await expect(svc.correctCaseSsn(ctx(), CASE_ID, { ssn: '1234', reason: 'Typo on the form' }, 'mock')).rejects.toMatchObject({ status: 400 });
  });
});

describe('one-time fill for existing cases', () => {
  const others = () => caseFixtures.filter((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted && c.id !== CASE_ID);
  let saved: Case[];
  beforeEach(() => {
    saved = caseFixtures.map((c) => c);
    submissions.push(submission('arr', ARRANGEMENT_FORMS_EXTERNAL_FORM_ID));
  });
  afterEach(() => {
    saved.forEach((c, i) => (caseFixtures[i] = c));
  });

  it('a preview reads the forms and changes nothing', async () => {
    const report = await svc.backfillCaseSsns(ctx(), { dryRun: true }, 'mock');
    expect(report.dryRun).toBe(true);
    expect(report.checked).toBe(others().length + 1);
    expect(report.counts.would_save).toBe(report.checked); // every case here finds the simulated form
    expect(caseFixtures.some((c) => c.ssnOnFile)).toBe(false);
    expect(activityEventFixtures).toHaveLength(0);
    expect(JSON.stringify(report)).not.toMatch(/\d{3}-?\d{2}-?\d{4}/);
  });

  it('the fill saves and locks each case that has none — never replacing one already on file', async () => {
    await svc.correctCaseSsn(ctx(), CASE_ID, { ssn: '000-55-1111', reason: 'Entered by hand earlier' }, 'mock');
    const report = await svc.backfillCaseSsns(ctx(), { dryRun: false }, 'mock');
    expect(report.counts.already_on_file).toBe(1);
    expect(report.counts.saved).toBe(report.checked - 1);
    expect((await svc.readCaseSsn(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock'))?.ssn).toBe('000-55-1111');
    expect(activityEventFixtures.filter((e) => e.eventType === 'case.ssn_captured')).toHaveLength(report.counts.saved);
    noDigits();
    // Running it again finds everything already on file.
    expect((await svc.backfillCaseSsns(ctx(), { dryRun: false }, 'mock')).counts.saved).toBe(0);
  });

  it('archived cases are not included', async () => {
    caseFixtures[index] = { ...caseFixtures[index], isDeleted: true };
    const report = await svc.backfillCaseSsns(ctx(), { dryRun: false }, 'mock');
    expect(report.cases.map((c) => c.caseNumber)).not.toContain(original.caseNumber);
    expect(await svc.readCaseSsn(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock')).toBeNull();
  });

  it('cases whose forms hold no SSN are reported for staff', async () => {
    answersBySubmission.clear();
    const report = await svc.backfillCaseSsns(ctx(), { dryRun: true }, 'mock');
    expect(report.counts.none_found).toBe(report.checked);
  });

  it('refuses without its encryption key in production, and for an organization without the feature', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SSN_ENCRYPTION_KEY', '');
    await expect(svc.backfillCaseSsns(ctx(), { dryRun: true }, 'mock')).rejects.toMatchObject({ status: 503 });
    vi.unstubAllEnvs();
    await expect(svc.backfillCaseSsns({ ...ctx(), organizationId: SECOND_MOCK_ORGANIZATION_ID }, { dryRun: true }, 'mock')).rejects.toMatchObject({ status: 404 });
  });
});
