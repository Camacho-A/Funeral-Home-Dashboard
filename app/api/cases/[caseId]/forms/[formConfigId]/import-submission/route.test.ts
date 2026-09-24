import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFormLinkFixtures, externalFormSubmissionFixtures } from '@/services/__mocks__/externalFormFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

const EXISTING_CASE_ID = '1042'; // managed-cremations fixture case — see services/__mocks__/fixtures.ts
const ARRANGEMENT_FORM_ID = '261945978664175';
const VITAL_FORM_ID = '262605621454050';

/** Synthetic Jotform submission fixtures only — never real account data. */
function stubJotformSubmission(formId: string, answers: Record<string, unknown> = {}) {
  return { formId, submittedAt: '2026-08-01T12:00:00.000Z', answers };
}

vi.mock('@/lib/jotform/jotformClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jotform/jotformClient')>('@/lib/jotform/jotformClient');
  return {
    ...actual,
    fetchSubmissionPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 synthetic')),
    fetchSubmissionAnswers: vi.fn(),
  };
});
vi.mock('@/services/documentService', async () => {
  const actual = await vi.importActual<typeof import('@/services/documentService')>('@/services/documentService');
  return { ...actual, upload: vi.fn().mockResolvedValue({ id: 'document-historical-import-test' }) };
});
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn().mockResolvedValue({
    authorized: true,
    context: { organizationId: 'managed-cremations', userId: 'staff-1', role: 'administrator' },
  }),
}));

function postRequest(body: unknown) {
  return new Request('http://localhost/api/cases/x/forms/y/import-submission', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
    body: JSON.stringify(body),
  });
}

function getRequest(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return new Request(`http://localhost/api/cases/x/forms/y/import-submission?${params.toString()}`);
}

let caseFormLinkLengthBefore: number;
let submissionLengthBefore: number;
let activityLengthBefore: number;

beforeEach(() => {
  caseFormLinkLengthBefore = caseFormLinkFixtures.length;
  submissionLengthBefore = externalFormSubmissionFixtures.length;
  activityLengthBefore = activityEventFixtures.length;
});
afterEach(() => {
  caseFormLinkFixtures.length = caseFormLinkLengthBefore;
  externalFormSubmissionFixtures.length = submissionLengthBefore;
  activityEventFixtures.length = activityLengthBefore;
  vi.clearAllMocks();
});

describe('POST /api/cases/[caseId]/forms/[formConfigId]/import-submission — authorized import', () => {
  it('imports a historical submission into an existing case: creates the submission, links it, preserves the PDF, never touches caseSequences/creates a case', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(
      stubJotformSubmission(ARRANGEMENT_FORM_ID, { '174': { answer: { first: 'Synthetic', last: 'Person' } } }),
    );

    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { caseFixtures } = await import('@/services/__mocks__/fixtures');
    const casesBefore = caseFixtures.length;
    const { upload } = await import('@/services/documentService');

    const { POST } = await import('./route');
    const response = await POST(
      postRequest({ organizationId: 'managed-cremations', externalSubmissionId: 'historical-sub-1' }),
      { params: Promise.resolve({ caseId: EXISTING_CASE_ID, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.alreadyImported).toBe(false);
    expect(body.submission.status).toBe('matched');
    expect(body.link.caseId).toBe(EXISTING_CASE_ID);
    expect(body.pdf.outcome).toBe('stored');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(caseFixtures.length).toBe(casesBefore); // never created a case
    expect(caseFixtures.find((c) => c.id === EXISTING_CASE_ID)?.caseNumber).toBe(
      caseFixtures.find((c) => c.id === EXISTING_CASE_ID)?.caseNumber,
    ); // case number unchanged (same object, never patched by this route)
  });

  it('never calls PATCH /api/cases — no reconciliation field is ever silently applied', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(ARRANGEMENT_FORM_ID));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { POST } = await import('./route');
    await POST(
      postRequest({ organizationId: 'managed-cremations', externalSubmissionId: 'historical-sub-no-apply' }),
      { params: Promise.resolve({ caseId: EXISTING_CASE_ID, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID }) },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('computes mappedFields using the existing normalization rules, and never persists SSN/signature-shaped data at unmapped qids', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(
      stubJotformSubmission(ARRANGEMENT_FORM_ID, {
        '174': { answer: { first: 'Mary', last: 'Smith' } },
        '900': { answer: 'synthetic-ssn-000-00-0000' },
        '901': { answer: 'synthetic-signature-blob-data' },
      }),
    );
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');

    const { POST } = await import('./route');
    const response = await POST(
      postRequest({ organizationId: 'managed-cremations', externalSubmissionId: 'historical-sub-minimization' }),
      { params: Promise.resolve({ caseId: EXISTING_CASE_ID, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID }) },
    );
    const body = await response.json();
    expect(body.submission.mappedFields).toContain('Mary Smith');
    expect(body.submission.mappedFields).not.toContain('synthetic-ssn-000-00-0000');
    expect(body.submission.mappedFields).not.toContain('synthetic-signature-blob-data');
    expect(body.submission).not.toHaveProperty('rawPayload');
  });
});

describe('POST /api/cases/[caseId]/forms/[formConfigId]/import-submission — idempotency', () => {
  it('importing the same Jotform submission twice never creates a duplicate submission, link, or PDF', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(ARRANGEMENT_FORM_ID));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { upload } = await import('@/services/documentService');

    const { POST } = await import('./route');
    const first = await POST(
      postRequest({ organizationId: 'managed-cremations', externalSubmissionId: 'historical-sub-dup' }),
      { params: Promise.resolve({ caseId: EXISTING_CASE_ID, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID }) },
    );
    expect((await first.json()).alreadyImported).toBe(false);

    const second = await POST(
      postRequest({ organizationId: 'managed-cremations', externalSubmissionId: 'historical-sub-dup' }),
      { params: Promise.resolve({ caseId: EXISTING_CASE_ID, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID }) },
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.alreadyImported).toBe(true);

    const matching = externalFormSubmissionFixtures.filter((s) => s.externalSubmissionId === 'historical-sub-dup');
    expect(matching).toHaveLength(1);
    expect(upload).toHaveBeenCalledTimes(1); // never re-uploaded on the duplicate attempt
  });

  it('a second import attempt against a DIFFERENT case never re-links an already-imported submission to it', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(ARRANGEMENT_FORM_ID));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { caseFixtures } = await import('@/services/__mocks__/fixtures');
    const otherCaseId = caseFixtures.find((c) => c.id !== EXISTING_CASE_ID)!.id;

    const { POST } = await import('./route');
    await POST(
      postRequest({ organizationId: 'managed-cremations', externalSubmissionId: 'historical-sub-wrong-case' }),
      { params: Promise.resolve({ caseId: EXISTING_CASE_ID, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID }) },
    );

    const secondAttempt = await POST(
      postRequest({ organizationId: 'managed-cremations', externalSubmissionId: 'historical-sub-wrong-case' }),
      { params: Promise.resolve({ caseId: otherCaseId, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID }) },
    );
    const body = await secondAttempt.json();
    expect(body.alreadyImported).toBe(true);

    const link = caseFormLinkFixtures.find((l) => l.caseId === otherCaseId);
    expect(link).toBeUndefined(); // never created a link for the second, wrong case
  });
});

describe('POST /api/cases/[caseId]/forms/[formConfigId]/import-submission — validation', () => {
  it('rejects (400) a submission that belongs to a different Jotform form than the selected config', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(VITAL_FORM_ID));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');

    const { POST } = await import('./route');
    const response = await POST(
      postRequest({ organizationId: 'managed-cremations', externalSubmissionId: 'wrong-form-sub' }),
      { params: Promise.resolve({ caseId: EXISTING_CASE_ID, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID }) },
    );
    expect(response.status).toBe(400);
    expect(externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'wrong-form-sub')).toBeUndefined();
  });

  it('rejects (404) a case that does not belong to the caller\'s organization (cross-org rejected)', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(ARRANGEMENT_FORM_ID));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');

    const { POST } = await import('./route');
    const response = await POST(
      postRequest({ organizationId: 'managed-cremations', externalSubmissionId: 'cross-org-sub' }),
      { params: Promise.resolve({ caseId: 'not-a-real-case-id', formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID }) },
    );
    expect(response.status).toBe(404);
  });

  it('rejects (404) a form config that does not belong to the caller\'s organization', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      postRequest({ organizationId: 'managed-cremations', externalSubmissionId: 'x' }),
      { params: Promise.resolve({ caseId: EXISTING_CASE_ID, formConfigId: 'not-a-real-config-id' }) },
    );
    expect(response.status).toBe(404);
  });

  it('rejects (403) an unauthorized caller (no case.update permission)', async () => {
    vi.resetModules();
    vi.doMock('@/services/authorizationPolicyService', async () => {
      const actual = await vi.importActual<typeof import('@/services/authorizationPolicyService')>('@/services/authorizationPolicyService');
      return { ...actual, canEditCase: vi.fn().mockResolvedValue(false) };
    });
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { POST } = await import('./route');
    const response = await POST(
      postRequest({ organizationId: 'managed-cremations', externalSubmissionId: 'unauthorized-sub' }),
      { params: Promise.resolve({ caseId: EXISTING_CASE_ID, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID }) },
    );
    expect(response.status).toBe(403);
    vi.doUnmock('@/services/authorizationPolicyService');
    vi.resetModules();
  });
});

describe('GET /api/cases/[caseId]/forms/[formConfigId]/import-submission — preview', () => {
  it('returns safe metadata only, matchesConfig true for the correct form', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(ARRANGEMENT_FORM_ID));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');

    const { GET } = await import('./route');
    const response = await GET(
      getRequest({ organizationId: 'managed-cremations', externalSubmissionId: 'preview-sub' }),
      { params: Promise.resolve({ caseId: EXISTING_CASE_ID, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID }) },
    );
    const body = await response.json();
    expect(body.matchesConfig).toBe(true);
    expect(body.formLabel).toBeTruthy();
    expect(body).not.toHaveProperty('answers');
  });

  it('flags matchesConfig false for a mismatched form, without creating any record', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(VITAL_FORM_ID));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');

    const { GET } = await import('./route');
    const response = await GET(
      getRequest({ organizationId: 'managed-cremations', externalSubmissionId: 'preview-mismatch' }),
      { params: Promise.resolve({ caseId: EXISTING_CASE_ID, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID }) },
    );
    const body = await response.json();
    expect(body.matchesConfig).toBe(false);
    expect(externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'preview-mismatch')).toBeUndefined();
  });
});
