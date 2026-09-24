import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { externalFormSubmissionFixtures, caseFormLinkFixtures } from '@/services/__mocks__/externalFormFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

const ARRANGEMENT_FORM_ID = '261945978664175';
const VITAL_FORM_ID = '262605621454050';
const ORG = 'managed-cremations';

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
  return { ...actual, upload: vi.fn().mockResolvedValue({ id: 'document-historical-case-test' }) };
});
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn().mockResolvedValue({
    authorized: true,
    context: { organizationId: ORG, userId: 'staff-1', role: 'administrator' },
  }),
}));

function postRequest(body: unknown) {
  return new Request('http://localhost/api/cases/historical-jotform-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
    body: JSON.stringify(body),
  });
}
function getRequest(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return new Request(`http://localhost/api/cases/historical-jotform-import?${params.toString()}`);
}

function stubCaseCreation(caseId = 'new-case-id-1', caseNumber = 'B2026-999') {
  return vi.fn().mockImplementation(async (url: string) => {
    if (String(url).endsWith('/api/cases')) {
      return new Response(JSON.stringify({ case: { id: caseId, caseNumber } }), { status: 201 });
    }
    throw new Error(`Unexpected fetch call in test: ${url}`);
  });
}

let submissionLengthBefore: number;
let caseFormLinkLengthBefore: number;
let activityLengthBefore: number;

beforeEach(() => {
  submissionLengthBefore = externalFormSubmissionFixtures.length;
  caseFormLinkLengthBefore = caseFormLinkFixtures.length;
  activityLengthBefore = activityEventFixtures.length;
});
afterEach(() => {
  externalFormSubmissionFixtures.length = submissionLengthBefore;
  caseFormLinkFixtures.length = caseFormLinkLengthBefore;
  activityEventFixtures.length = activityLengthBefore;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/cases/historical-jotform-import — safe preview', () => {
  it('returns only safe, approved fields — decedent/dates, Informant reference data, no prohibited data', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(
      stubJotformSubmission(ARRANGEMENT_FORM_ID, {
        '87': { answer: { first: 'Jordan', last: 'Blake' } },
        '122': { answer: { first: 'Pat', last: 'Rivera' } },
        '224': { answer: { full: '(555) 200-3000' } },
        '225': { answer: 'Spouse' },
        '900': { answer: 'synthetic-ssn-000-00-0000' },
      }),
    );
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');

    const { GET } = await import('./route');
    const response = await GET(getRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'preview-1' }));
    const body = await response.json();

    expect(body.decedentName).toBe('Jordan Blake');
    expect(body.informantName).toBe('Pat Rivera');
    expect(body.informantPhone).toBe('(555) 200-3000');
    expect(body.informantRelationship).toBe('Spouse');
    expect(body.matchesConfig).toBe(true);
    expect(body.alreadyAssociated).toBe(false);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('synthetic-ssn-000-00-0000');
    expect(serialized).not.toContain('nextOfKinName'); // never pre-suggested from Informant
    expect(body).not.toHaveProperty('answers');
    expect(body).not.toHaveProperty('rawRequest');
  });

  it('flags matchesConfig false for a submission belonging to the wrong form, without creating any record', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(VITAL_FORM_ID));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');

    const { GET } = await import('./route');
    const response = await GET(getRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'preview-mismatch' }));
    const body = await response.json();
    expect(body.matchesConfig).toBe(false);
    expect(externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'preview-mismatch')).toBeUndefined();
  });

  it('flags alreadyAssociated when the submission has already been imported', async () => {
    const { receive, markCaseCreated } = await import('@/services/externalFormSubmissionService');
    const { submission } = await receive(
      { organizationId: ORG, provider: 'jotform', externalFormId: ARRANGEMENT_FORM_ID, externalSubmissionId: 'preview-already', caseFormLinkId: null, mappedFields: '{}', pdfStatus: 'pending' },
      'mock',
    );
    await markCaseCreated(submission.id, 'existing-case-abc', 'mock');
    await import('@/services/externalFormSubmissionService').then((m) => m.markLinked(submission.id, 'some-link-id', 'mock'));

    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(ARRANGEMENT_FORM_ID));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');

    const { GET } = await import('./route');
    const response = await GET(getRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'preview-already' }));
    const body = await response.json();
    expect(body.alreadyAssociated).toBe(true);
    expect(body.existingCaseId).toBe('existing-case-abc');
  });
});

describe('POST /api/cases/historical-jotform-import — validation', () => {
  it('rejects (400) when nextOfKinName is missing', async () => {
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { POST } = await import('./route');
    const response = await POST(postRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'x', nextOfKinPhone: '5551234567' }));
    expect(response.status).toBe(400);
  });

  it('rejects (400) when nextOfKinPhone is missing', async () => {
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { POST } = await import('./route');
    const response = await POST(postRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'x', nextOfKinName: 'Jamie Doe' }));
    expect(response.status).toBe(400);
  });

  it('rejects (400) a submission belonging to the wrong form, before any mutation', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(VITAL_FORM_ID));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');

    const { POST } = await import('./route');
    const response = await POST(
      postRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'wrong-form', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '5551234567' }),
    );
    expect(response.status).toBe(400);
    expect(externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'wrong-form')).toBeUndefined();
  });

  it('rejects (502) when the Jotform fetch itself fails, before any mutation', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');

    const { POST } = await import('./route');
    const response = await POST(
      postRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'jotform-fetch-fail', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '5551234567' }),
    );
    expect(response.status).toBe(502);
    expect(externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'jotform-fetch-fail')).toBeUndefined();
  });

  it('rejects (404) a form config that does not belong to the caller\'s organization', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      postRequest({ organizationId: ORG, formConfigId: 'not-a-real-config-id', externalSubmissionId: 'x', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '5551234567' }),
    );
    expect(response.status).toBe(404);
  });
});

describe('POST /api/cases/historical-jotform-import — successful creation', () => {
  it('creates a case via the normal POST /api/cases loopback, links the submission, preserves the PDF, and never predicts the case number', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(
      stubJotformSubmission(ARRANGEMENT_FORM_ID, { '87': { answer: { first: 'Jordan', last: 'Blake' } } }),
    );
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { upload } = await import('@/services/documentService');

    const fetchSpy = stubCaseCreation('new-case-id-1', 'B2026-999');
    vi.stubGlobal('fetch', fetchSpy);

    const { POST } = await import('./route');
    const response = await POST(
      postRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'create-1', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '(555) 123-4567' }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.alreadyImported).toBe(false);
    expect(body.caseId).toBe('new-case-id-1');
    expect(body.caseNumber).toBe('B2026-999'); // the REAL number from the stubbed response, never fabricated
    expect(body.submission.status).toBe('matched');
    expect(body.pdf.outcome).toBe('stored');
    expect(upload).toHaveBeenCalledTimes(1);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toBe('http://localhost/api/cases');
    expect(calledInit.method).toBe('POST');
    const sentBody = JSON.parse(calledInit.body);
    expect(sentBody.decedentName).toBe('Jordan Blake');
    expect(sentBody.nextOfKinName).toBe('Jamie Doe');
    expect(sentBody.nextOfKinPhone).toBe('(555) 123-4567');
  });

  it('persists createdCaseId immediately after case creation, before linking', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(ARRANGEMENT_FORM_ID, { '87': { answer: { first: 'A', last: 'B' } } }));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    vi.stubGlobal('fetch', stubCaseCreation('new-case-id-2', 'B2026-998'));

    const { POST } = await import('./route');
    await POST(postRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'create-2', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '5551234567' }));

    const { getById } = await import('@/services/externalFormSubmissionService');
    const { externalFormSubmissionId } = await import('@/types/externalFormSubmission');
    const id = externalFormSubmissionId(ORG, 'jotform', 'create-2');
    const stored = await getById(id, 'mock');
    expect(stored?.createdCaseId).toBe('new-case-id-2');
  });

  it('never applies reconciliation fields automatically — the only fetch is to /api/cases, never to a review/apply endpoint', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(ARRANGEMENT_FORM_ID, { '87': { answer: { first: 'A', last: 'B' } } }));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const fetchSpy = stubCaseCreation();
    vi.stubGlobal('fetch', fetchSpy);

    const { POST } = await import('./route');
    await POST(postRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'create-no-reconcile', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '5551234567' }));

    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain('/review');
    }
  });

  it('never persists SSN/signature-shaped synthetic data in mappedFields', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(
      stubJotformSubmission(ARRANGEMENT_FORM_ID, {
        '87': { answer: { first: 'A', last: 'B' } },
        '900': { answer: 'synthetic-ssn-000-00-0000' },
      }),
    );
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    vi.stubGlobal('fetch', stubCaseCreation());

    const { POST } = await import('./route');
    const response = await POST(
      postRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'create-minimization', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '5551234567' }),
    );
    const body = await response.json();
    expect(body.submission.mappedFields).not.toContain('synthetic-ssn-000-00-0000');
    expect(body.submission).not.toHaveProperty('rawPayload');
  });
});

describe('POST /api/cases/historical-jotform-import — idempotency and crash recovery', () => {
  it('a second POST for an already-completed submission returns alreadyImported, creates no second case', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(ARRANGEMENT_FORM_ID, { '87': { answer: { first: 'A', last: 'B' } } }));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const fetchSpy = stubCaseCreation('new-case-id-3', 'B2026-997');
    vi.stubGlobal('fetch', fetchSpy);

    const { POST } = await import('./route');
    const first = await POST(postRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'dup-1', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '5551234567' }));
    expect((await first.json()).alreadyImported).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await POST(postRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'dup-1', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '5551234567' }));
    const secondBody = await second.json();
    expect(secondBody.alreadyImported).toBe(true);
    expect(secondBody.caseId).toBe('new-case-id-3');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // never a second /api/cases call

    const matching = externalFormSubmissionFixtures.filter((s) => s.externalSubmissionId === 'dup-1');
    expect(matching).toHaveLength(1);
  });

  it('sequential double-click protection: two immediate sequential POSTs never create two cases', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(ARRANGEMENT_FORM_ID, { '87': { answer: { first: 'A', last: 'B' } } }));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const fetchSpy = stubCaseCreation();
    vi.stubGlobal('fetch', fetchSpy);

    const { POST } = await import('./route');
    const body = { organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'double-click', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '5551234567' };
    await POST(postRequest(body));
    await POST(postRequest(body));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('concurrent same-submission requests: exactly one case-creation attempt ever happens', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(ARRANGEMENT_FORM_ID, { '87': { answer: { first: 'A', last: 'B' } } }));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const fetchSpy = stubCaseCreation();
    vi.stubGlobal('fetch', fetchSpy);

    const { POST } = await import('./route');
    const body = { organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'concurrent-1', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '5551234567' };
    const [a, b] = await Promise.all([POST(postRequest(body)), POST(postRequest(body))]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const statuses = [a.status, b.status].sort();
    // Exactly one succeeds; the other safely reports "still processing" —
    // never two successes, never a thrown error.
    expect(statuses[0]).toBeLessThan(400);
    expect(statuses).not.toEqual([200, 200]);
  });

  it('resumes at linking (never re-creates a case) when createdCaseId is already set but linking never completed', async () => {
    const { receive } = await import('@/services/externalFormSubmissionService');
    const { markCaseCreated } = await import('@/services/externalFormSubmissionService');
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(ARRANGEMENT_FORM_ID, { '87': { answer: { first: 'A', last: 'B' } } }));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');

    // Simulate a prior crash: the submission was claimed and a case was
    // created, but linking never completed.
    const { submission } = await receive(
      { organizationId: ORG, provider: 'jotform', externalFormId: ARRANGEMENT_FORM_ID, externalSubmissionId: 'resume-1', caseFormLinkId: null, mappedFields: '{}', pdfStatus: 'pending' },
      'mock',
    );
    await markCaseCreated(submission.id, 'pre-existing-case-id', 'mock');

    const fetchSpy = stubCaseCreation();
    vi.stubGlobal('fetch', fetchSpy);

    const { POST } = await import('./route');
    const response = await POST(
      postRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'resume-1', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '5551234567' }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.caseId).toBe('pre-existing-case-id');
    expect(body.submission.status).toBe('matched');
    expect(fetchSpy).not.toHaveBeenCalled(); // never re-created a case
  });

  it('a completed retry (already matched + createdCaseId set) returns the existing association safely', async () => {
    const { receive, markCaseCreated, markLinked } = await import('@/services/externalFormSubmissionService');
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(ARRANGEMENT_FORM_ID));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');

    const { submission } = await receive(
      { organizationId: ORG, provider: 'jotform', externalFormId: ARRANGEMENT_FORM_ID, externalSubmissionId: 'completed-retry', caseFormLinkId: null, mappedFields: '{}', pdfStatus: 'pending' },
      'mock',
    );
    await markCaseCreated(submission.id, 'completed-case-id', 'mock');
    await markLinked(submission.id, 'some-link', 'mock');

    const fetchSpy = stubCaseCreation();
    vi.stubGlobal('fetch', fetchSpy);

    const { POST } = await import('./route');
    const response = await POST(
      postRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'completed-retry', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '5551234567' }),
    );
    const body = await response.json();
    expect(body.alreadyImported).toBe(true);
    expect(body.caseId).toBe('completed-case-id');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('PDF preservation failure never blocks the case/link, and a retry never re-uploads or creates a second case', async () => {
    const { fetchSubmissionPdf } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionPdf as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('pdf-fetch-failed'));
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(ARRANGEMENT_FORM_ID, { '87': { answer: { first: 'A', last: 'B' } } }));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const fetchSpy = stubCaseCreation();
    vi.stubGlobal('fetch', fetchSpy);

    const { POST } = await import('./route');
    const body = { organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'pdf-fail-1', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '5551234567' };
    const first = await POST(postRequest(body));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.pdf.outcome).toBe('failed');
    expect(firstBody.submission.status).toBe('matched'); // the submission/link/case all still succeeded

    const second = await POST(postRequest(body));
    const secondBody = await second.json();
    expect(secondBody.alreadyImported).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // never a second case
  });
});

describe('POST /api/cases/historical-jotform-import — mutual exclusivity with the existing "link to existing case" importer', () => {
  it('a submission already linked to an EXISTING case (via the other importer) is never used to create a new one', async () => {
    const { receive, markLinked } = await import('@/services/externalFormSubmissionService');
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(ARRANGEMENT_FORM_ID));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');

    // Simulate the OTHER importer's own outcome: matched, but createdCaseId
    // was never set (that importer never touches it).
    const { submission } = await receive(
      { organizationId: ORG, provider: 'jotform', externalFormId: ARRANGEMENT_FORM_ID, externalSubmissionId: 'other-importer-1', caseFormLinkId: null, mappedFields: '{}', pdfStatus: 'pending' },
      'mock',
    );
    await markLinked(submission.id, 'existing-case-link', 'mock');

    const fetchSpy = stubCaseCreation();
    vi.stubGlobal('fetch', fetchSpy);

    const { POST } = await import('./route');
    const response = await POST(
      postRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'other-importer-1', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '5551234567' }),
    );
    const body = await response.json();
    expect(body.alreadyImported).toBe(true);
    expect(body.caseId).toBeNull(); // not this route's case to report
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a submission this route already used to create a case is refused by the "link to existing case" importer too', async () => {
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    (fetchSubmissionAnswers as ReturnType<typeof vi.fn>).mockResolvedValue(stubJotformSubmission(ARRANGEMENT_FORM_ID, { '87': { answer: { first: 'A', last: 'B' } } }));
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { caseFixtures } = await import('@/services/__mocks__/fixtures');
    const otherRealCaseId = caseFixtures.find((c) => c.organizationId === ORG)!.id;
    vi.stubGlobal('fetch', stubCaseCreation('new-case-id-4', 'B2026-996'));

    const { POST } = await import('./route');
    await POST(
      postRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'cross-check-1', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '5551234567' }),
    );

    const otherRouteModule = await import('@/app/api/cases/[caseId]/forms/[formConfigId]/import-submission/route');
    const otherResponse = await otherRouteModule.POST(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
        body: JSON.stringify({ organizationId: ORG, externalSubmissionId: 'cross-check-1' }),
      }),
      { params: Promise.resolve({ caseId: otherRealCaseId, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID }) },
    );
    const otherBody = await otherResponse.json();
    expect(otherBody.alreadyImported).toBe(true);

    const linksForOtherCase = caseFormLinkFixtures.filter((l) => l.caseId === otherRealCaseId);
    expect(linksForOtherCase).toHaveLength(0); // never relinked elsewhere
  });
});

// This RBAC-denial test is placed in its own final describe block,
// deliberately last in the file: vi.resetModules() disconnects this
// file's own top-level `externalFormSubmissionFixtures`/`caseFormLinkFixtures`
// bindings from whatever fresh module instances any LATER test's dynamic
// `await import(...)` calls would resolve to — every other test in this
// file depends on those top-level bindings staying connected to what the
// route under test actually mutates, so nothing that calls
// vi.resetModules() may run before them.
describe('POST /api/cases/historical-jotform-import — authorization (kept last in this file, see comment above)', () => {
  it('rejects (403) an unauthorized caller lacking case.create', async () => {
    vi.resetModules();
    vi.doMock('@/services/authorizationPolicyService', async () => {
      const actual = await vi.importActual<typeof import('@/services/authorizationPolicyService')>('@/services/authorizationPolicyService');
      return { ...actual, canCreateCase: vi.fn().mockResolvedValue(false) };
    });
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { POST } = await import('./route');
    const response = await POST(
      postRequest({ organizationId: ORG, formConfigId: ARRANGEMENT_FORMS_FORM_CONFIG_ID, externalSubmissionId: 'unauthorized', nextOfKinName: 'Jamie Doe', nextOfKinPhone: '5551234567' }),
    );
    expect(response.status).toBe(403);
    vi.doUnmock('@/services/authorizationPolicyService');
  });
});
