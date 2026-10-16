import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  caseFormLinkFixtures,
  externalFormSubmissionFixtures,
  externalFormConfigFixtures,
  ARRANGEMENT_FORMS_FORM_CONFIG_ID,
  FIRST_CALL_SHEET_FORM_CONFIG_ID,
} from '@/services/__mocks__/externalFormFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import {
  ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
  FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
} from '@/domain/externalForms/fieldMapping';

/**
 * Unmatched Forms → Create Case (2026-10). Exercises the real route
 * against the real intake service; only the Jotform API round-trip and
 * the `POST /api/cases` network hop are stubbed, so authorization,
 * eligibility, verification, duplicate detection and the CaseFormLink
 * write are all genuinely executed.
 */

const { submissionApiRecords } = vi.hoisted(() => ({
  submissionApiRecords: new Map<
    string,
    { formId: string; submittedAt: string | null; answers: Record<string, { answer: string | Record<string, string> }> }
  >(),
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
  return { ...actual, upload: vi.fn().mockResolvedValue({ id: 'document-create-case-test' }) };
});

vi.mock('@/services/workflowReconciliationService', async () => {
  const actual = await vi.importActual<typeof import('@/services/workflowReconciliationService')>('@/services/workflowReconciliationService');
  return { ...actual, reconcileCaseWorkflow: vi.fn(actual.reconcileCaseWorkflow) };
});

let authorizedOrganizationId = DEFAULT_ORGANIZATION_ID;
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn(async (requested: string) => {
    if (requested !== authorizedOrganizationId) {
      return { authorized: false, response: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }) };
    }
    return {
      authorized: true,
      context: { organizationId: requested, userId: 'staff-dana', role: 'administrator' },
    };
  }),
}));

let casePostBodies: Record<string, unknown>[] = [];
function stubCaseCreationFetch() {
  casePostBodies = [];
  let next = 700;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (!url.endsWith('/api/cases')) throw new Error(`Unexpected fetch to ${url}`);
      const body = JSON.parse(init!.body as string) as Record<string, unknown>;
      casePostBodies.push(body);
      return {
        ok: true,
        status: 201,
        json: async () => ({ case: { id: `case-made-${casePostBodies.length}`, caseNumber: `B2026-${next++}` } }),
      };
    }),
  );
}

/** Deliberately OLD — these are the historical submissions this feature
    exists to rescue, well beyond the webhook's 36-hour replay bound. */
const HISTORICAL_TIMESTAMP = '2026-09-20 11:05:00';

function arrangementAnswers(overrides: Record<string, string | Record<string, string>> = {}) {
  return {
    '87': { first: 'ROSELYN', last: 'COLON' },
    '8': '01/02/1948',
    '10': '10/07/2026',
    '122': { first: 'ANA', last: 'COLON' },
    '224': { full: '(555) 771-2200' },
    '225': 'Daughter',
    '276': 'Yes',
    ...overrides,
  };
}

function firstCallAnswers(overrides: Record<string, string | Record<string, string>> = {}) {
  return {
    '3': { first: 'HAROLD', last: 'VANCE' },
    '22': { first: 'JUNE', last: 'VANCE' },
    '23': { full: '(555) 880-4411' },
    '8': '10/01/2026',
    ...overrides,
  };
}

async function seedSubmission(params: {
  externalFormId: string;
  externalSubmissionId: string;
  answers: Record<string, string | Record<string, string>>;
  organizationId?: string;
}) {
  const answers: Record<string, { answer: string | Record<string, string> }> = {};
  for (const [qid, value] of Object.entries(params.answers)) answers[qid] = { answer: value };
  submissionApiRecords.set(params.externalSubmissionId, {
    formId: params.externalFormId,
    submittedAt: HISTORICAL_TIMESTAMP,
    answers,
  });

  const { receive } = await import('@/services/externalFormSubmissionService');
  const { submission } = await receive(
    {
      organizationId: params.organizationId ?? DEFAULT_ORGANIZATION_ID,
      provider: 'jotform',
      externalFormId: params.externalFormId,
      externalSubmissionId: params.externalSubmissionId,
      caseFormLinkId: null,
      mappedFields: '{}',
      pdfStatus: 'pending',
    },
    'mock',
  );
  return submission;
}

function postRequest(submissionId: string, body: unknown) {
  return new Request(`http://localhost/api/external-form-submissions/${submissionId}/create-case`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
    body: JSON.stringify(body),
  });
}

function getRequest(submissionId: string, organizationId: string) {
  return new Request(
    `http://localhost/api/external-form-submissions/${submissionId}/create-case?organizationId=${organizationId}`,
  );
}

const params = (submissionId: string) => ({ params: Promise.resolve({ submissionId }) });

let lengths: Record<string, number>;
beforeEach(() => {
  process.env.JOTFORM_API_KEY = 'test-api-key';
  authorizedOrganizationId = DEFAULT_ORGANIZATION_ID;
  submissionApiRecords.clear();
  lengths = {
    links: caseFormLinkFixtures.length,
    submissions: externalFormSubmissionFixtures.length,
    activity: activityEventFixtures.length,
    cases: caseFixtures.length,
  };
  stubCaseCreationFetch();
});

afterEach(() => {
  delete process.env.JOTFORM_API_KEY;
  submissionApiRecords.clear();
  caseFormLinkFixtures.length = lengths.links;
  externalFormSubmissionFixtures.length = lengths.submissions;
  activityEventFixtures.length = lengths.activity;
  caseFixtures.length = lengths.cases;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('POST .../create-case — creates a case from an unmatched submission', () => {
  it('creates a case from a historical Arrangement submission, long past the webhook replay window', async () => {
    // Exactly the shape of the stranded production submission: an
    // Arrangement form, weeks old, with no First Call and no link.
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643738',
      answers: arrangementAnswers(),
    });

    const { POST } = await import('./route');
    const response = await POST(
      postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }),
      params(submission.id),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.case.caseNumber).toMatch(/^B2026-/);
    expect(casePostBodies).toHaveLength(1);
    expect(casePostBodies[0].decedentName).toBe('ROSELYN COLON');
    // NOK derived from the Informant block via the qid 276 branch.
    expect(casePostBodies[0].nextOfKinName).toBe('ANA COLON');
    expect(casePostBodies[0].nextOfKinPhone).toBe('(555) 771-2200');
    expect(casePostBodies[0].dateOfDeath).toBe('10/07/2026');
  });

  it('never allocates a case number itself — it goes through POST /api/cases', async () => {
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643701',
      answers: arrangementAnswers(),
    });
    const { POST } = await import('./route');
    await POST(postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }), params(submission.id));

    expect(casePostBodies[0]).not.toHaveProperty('caseNumber');
    expect(casePostBodies[0].organizationId).toBe(DEFAULT_ORGANIZATION_ID);
  });

  it('creates a CaseFormLink so the checklist reflects the form that opened the case', async () => {
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643702',
      answers: arrangementAnswers(),
    });
    const before = caseFormLinkFixtures.length;
    const { POST } = await import('./route');
    await POST(postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }), params(submission.id));

    const added = caseFormLinkFixtures.slice(before);
    expect(added).toHaveLength(1);
    expect(added[0].status).toBe('received');
    expect(added[0].formConfigId).toBe(ARRANGEMENT_FORMS_FORM_CONFIG_ID);
    expect(added[0].submissionId).toBe(submission.id);
  });

  it('records the original submission against the new case, preserving provenance', async () => {
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643703',
      answers: arrangementAnswers(),
    });
    const before = activityEventFixtures.length;
    const { POST } = await import('./route');
    await POST(postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }), params(submission.id));

    const stored = externalFormSubmissionFixtures.find((s) => s.id === submission.id);
    expect(stored!.createdCaseId).toBeTruthy();
    // The original submission row is preserved, never replaced.
    expect(stored!.externalSubmissionId).toBe('6674600018717643703');

    const descriptions = activityEventFixtures.slice(before).map((e) => e.description).join(' | ');
    expect(descriptions).toMatch(/Arrangement/i);
    expect(descriptions).not.toMatch(/First Call/i);
  });

  it('also works for a First Call submission', async () => {
    const submission = await seedSubmission({
      externalFormId: FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643704',
      answers: firstCallAnswers(),
    });
    const { POST } = await import('./route');
    const response = await POST(
      postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }),
      params(submission.id),
    );

    expect(response.status).toBe(201);
    expect(casePostBodies[0].decedentName).toBe('HAROLD VANCE');
    expect(caseFormLinkFixtures.at(-1)!.formConfigId).toBe(FIRST_CALL_SHEET_FORM_CONFIG_ID);
  });
});

/**
 * PDF import and post-creation failures (2026-10). Staff "Create Case"
 * used to create the case without importing the submission's PDF; and a
 * failure in any step AFTER the case existed reported the whole creation
 * as failed, skipping the PDF and releasing the creation claim.
 */
describe('POST .../create-case — the form PDF', () => {
  it('imports the submission PDF onto the case it creates', async () => {
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643790',
      answers: arrangementAnswers(),
    });
    const { upload } = await import('@/services/documentService');
    const { POST } = await import('./route');
    const response = await POST(postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }), params(submission.id));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(upload).toHaveBeenCalledTimes(1);
    const [uploadParams] = vi.mocked(upload).mock.calls[0];
    expect(uploadParams.caseId).toBe(body.case.id);
    expect(uploadParams.fileName).toBe('Arrangement Forms.pdf');
    const stored = externalFormSubmissionFixtures.find((s) => s.id === submission.id)!;
    expect(stored.pdfStatus).toBe('stored');
    expect(stored.documentId).toBe('document-create-case-test');
  });

  it('a PDF failure does not fail creation — the case exists and the failure is recorded for retry', async () => {
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643791',
      answers: arrangementAnswers(),
    });
    const { fetchSubmissionPdf, JotformClientError } = await import('@/lib/jotform/jotformClient');
    vi.mocked(fetchSubmissionPdf).mockRejectedValueOnce(new JotformClientError('gone', 'http_error'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await import('./route');
    const response = await POST(postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }), params(submission.id));

    expect(response.status).toBe(201);
    const stored = externalFormSubmissionFixtures.find((s) => s.id === submission.id)!;
    expect(stored.pdfStatus).toBe('failed');
    expect(stored.createdCaseId).toBeTruthy();
    errors.mockRestore();
  });

  it('a workflow-reconciliation failure after the case exists still reports it created, imports the PDF, and keeps the claim', async () => {
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643792',
      answers: arrangementAnswers(),
    });
    const { reconcileCaseWorkflow } = await import('@/services/workflowReconciliationService');
    vi.mocked(reconcileCaseWorkflow).mockRejectedValueOnce(new Error('Wix unavailable'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { upload } = await import('@/services/documentService');
    const { POST } = await import('./route');

    const response = await POST(postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }), params(submission.id));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(upload).toHaveBeenCalledTimes(1);
    const stored = externalFormSubmissionFixtures.find((s) => s.id === submission.id)!;
    expect(stored.createdCaseId).toBe(body.case.id);

    // The claim was not released: a second request cannot open a second case.
    const again = await POST(postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }), params(submission.id));
    expect(again.status).toBe(409);
    expect(casePostBodies).toHaveLength(1);
    errors.mockRestore();
  });
});

describe('POST .../create-case — refuses when it must', () => {
  it('refuses a submission that already created a case, and creates no second one', async () => {
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643705',
      answers: arrangementAnswers(),
    });
    const { POST } = await import('./route');
    const first = await POST(postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }), params(submission.id));
    expect(first.status).toBe(201);

    const second = await POST(postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }), params(submission.id));
    expect(second.status).toBe(409);
    expect(casePostBodies).toHaveLength(1);
  });

  it('two concurrent requests create exactly one case', async () => {
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643706',
      answers: arrangementAnswers(),
    });
    const { POST } = await import('./route');
    const responses = await Promise.all([
      POST(postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }), params(submission.id)),
      POST(postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }), params(submission.id)),
    ]);

    expect(casePostBodies).toHaveLength(1);
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
  });

  it('refuses a form whose configuration does not permit case creation', async () => {
    const config = externalFormConfigFixtures.find((c) => c.id === ARRANGEMENT_FORMS_FORM_CONFIG_ID)!;
    const original = config.purpose;
    config.purpose = 'case_update';
    try {
      const submission = await seedSubmission({
        externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
        externalSubmissionId: '6674600018717643707',
        answers: arrangementAnswers(),
      });
      const { POST } = await import('./route');
      const response = await POST(
        postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }),
        params(submission.id),
      );
      expect(response.status).toBe(403);
      expect(casePostBodies).toHaveLength(0);
    } finally {
      config.purpose = original;
    }
  });

  it('refuses another organization’s submission — it is simply not found', async () => {
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643708',
      answers: arrangementAnswers(),
      organizationId: SECOND_MOCK_ORGANIZATION_ID,
    });
    const { POST } = await import('./route');
    const response = await POST(
      postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }),
      params(submission.id),
    );

    expect(response.status).toBe(404);
    expect(casePostBodies).toHaveLength(0);
  });

  it('refuses a caller who does not belong to the organization they name', async () => {
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643709',
      answers: arrangementAnswers(),
    });
    authorizedOrganizationId = SECOND_MOCK_ORGANIZATION_ID;
    const { POST } = await import('./route');
    const response = await POST(
      postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }),
      params(submission.id),
    );

    expect(response.status).toBe(403);
    expect(casePostBodies).toHaveLength(0);
  });

  it('refuses a cross-origin request', async () => {
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643710',
      answers: arrangementAnswers(),
    });
    const { POST } = await import('./route');
    const response = await POST(
      new Request(`http://localhost/api/external-form-submissions/${submission.id}/create-case`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://evil.test', Host: 'localhost' },
        body: JSON.stringify({ organizationId: DEFAULT_ORGANIZATION_ID }),
      }),
      params(submission.id),
    );

    expect(response.status).toBe(403);
    expect(casePostBodies).toHaveLength(0);
  });

  it('refuses when the submission cannot be verified with Jotform', async () => {
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643711',
      answers: arrangementAnswers(),
    });
    // The submission row exists in SOLIS but Jotform no longer vouches
    // for it — provenance fails, so nothing is created.
    submissionApiRecords.delete('6674600018717643711');

    const { POST } = await import('./route');
    const response = await POST(
      postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }),
      params(submission.id),
    );

    expect(response.status).toBe(401);
    expect(casePostBodies).toHaveLength(0);
  });
});

describe('POST .../create-case — duplicate protection', () => {
  function seedLookalikeCase() {
    caseFixtures.push({
      ...caseFixtures[0],
      id: 'case-lookalike',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseNumber: 'B2026-555',
      decedentName: 'ROSELYN COLON',
      dateOfBirth: '01/02/1948',
      dateOfDeath: '10/07/2026',
    });
  }

  it('refuses and returns the candidates when an existing case resembles the submission', async () => {
    seedLookalikeCase();
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643712',
      answers: arrangementAnswers(),
    });
    const { POST } = await import('./route');
    const response = await POST(
      postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }),
      params(submission.id),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.duplicateCandidates.map((c: { caseNumber: string }) => c.caseNumber)).toContain('B2026-555');
    expect(casePostBodies).toHaveLength(0);
  });

  it('creates once staff have reviewed the candidates and confirmed a different person', async () => {
    seedLookalikeCase();
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643713',
      answers: arrangementAnswers(),
    });
    const { POST } = await import('./route');
    const response = await POST(
      postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID, acknowledgedDuplicates: true }),
      params(submission.id),
    );

    expect(response.status).toBe(201);
    expect(casePostBodies).toHaveLength(1);
    // Nothing was merged into the lookalike case.
    expect(caseFixtures.find((c) => c.id === 'case-lookalike')!.decedentName).toBe('ROSELYN COLON');
  });

  it('a shared name alone is never treated as a duplicate', async () => {
    caseFixtures.push({
      ...caseFixtures[0],
      id: 'case-same-name',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseNumber: 'B2026-556',
      decedentName: 'ROSELYN COLON',
      dateOfBirth: '05/05/1930',
      dateOfDeath: '01/01/2019',
    });
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643714',
      answers: arrangementAnswers(),
    });
    const { POST } = await import('./route');
    const response = await POST(
      postRequest(submission.id, { organizationId: DEFAULT_ORGANIZATION_ID }),
      params(submission.id),
    );

    expect(response.status).toBe(201);
  });
});

describe('GET .../create-case — the confirmation payload', () => {
  it('returns what the dialog shows, derived server-side from verified answers', async () => {
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643715',
      answers: arrangementAnswers(),
    });
    const { GET } = await import('./route');
    const body = await (await GET(getRequest(submission.id, DEFAULT_ORGANIZATION_ID), params(submission.id))).json();

    expect(body.decedentName).toBe('ROSELYN COLON');
    expect(body.dateOfDeath).toBe('10/07/2026');
    expect(body.formLabel).toMatch(/Arrangement/i);
    expect(body.receivedAt).toBeTruthy();
    expect(body.duplicateCandidates).toEqual([]);
  });

  it('surfaces duplicate candidates before anything is created', async () => {
    caseFixtures.push({
      ...caseFixtures[0],
      id: 'case-preview-dupe',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseNumber: 'B2026-557',
      decedentName: 'ROSELYN COLON',
      dateOfBirth: '01/02/1948',
      dateOfDeath: '10/07/2026',
    });
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643716',
      answers: arrangementAnswers(),
    });
    const { GET } = await import('./route');
    const body = await (await GET(getRequest(submission.id, DEFAULT_ORGANIZATION_ID), params(submission.id))).json();

    expect(body.duplicateCandidates).toHaveLength(1);
    expect(body.duplicateCandidates[0].caseNumber).toBe('B2026-557');
    expect(body.duplicateCandidates[0].matchedOn).toEqual(['dateOfDeath', 'dateOfBirth']);
    expect(casePostBodies).toHaveLength(0);
  });

  it('refuses another organization’s submission', async () => {
    const submission = await seedSubmission({
      externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
      externalSubmissionId: '6674600018717643717',
      answers: arrangementAnswers(),
      organizationId: SECOND_MOCK_ORGANIZATION_ID,
    });
    const { GET } = await import('./route');
    const response = await GET(getRequest(submission.id, DEFAULT_ORGANIZATION_ID), params(submission.id));
    expect(response.status).toBe(404);
  });
});
