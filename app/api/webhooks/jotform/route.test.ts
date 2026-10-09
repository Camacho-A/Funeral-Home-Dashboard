import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFormLinkFixtures, externalFormSubmissionFixtures, externalFormConfigFixtures } from '@/services/__mocks__/externalFormFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

/**
 * Server-side webhook authentication (2026-10). This suite was
 * restructured when the hidden-field shared secret (`solisWebhookAuth`)
 * was retired: a hidden field's default value ships inside the public
 * form's own markup, so it authenticated nothing. The handler now treats
 * the POST body as an untrusted notification carrying only `formID` and
 * `submissionID`, and verifies those two claims — and sources every
 * answer — from Jotform's authenticated API.
 *
 * `submissionApiRecords` therefore IS the authority in these tests: a
 * submission the map does not know about is one Jotform would not hand
 * back, and the handler must reject the delivery.
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
    /** Stands in for `GET /submission/{id}`. An unregistered id reproduces
        the live API's empirically confirmed behaviour: Jotform answers
        **401 "You're not authorized to use (/submission-id)"** for a
        submission this account does not own — not 404. */
    fetchSubmissionAnswers: vi.fn(async (submissionId: string) => {
      const record = submissionApiRecords.get(submissionId);
      if (!record) {
        throw new actual.JotformClientError('Jotform submission retrieval failed with status 401.', 'http_error');
      }
      return record;
    }),
  };
});
vi.mock('@/services/documentService', async () => {
  const actual = await vi.importActual<typeof import('@/services/documentService')>('@/services/documentService');
  return { ...actual, upload: vi.fn().mockResolvedValue({ id: 'document-webhook-test' }) };
});

const VITAL_STATISTICS_FORM_ID = '262605621454050';
const VITAL_LINK_QID = '44';
const ARRANGEMENT_FORMS_FORM_ID = '261945978664175';
const ARRANGEMENT_LINK_QID = '274';

/** The retired hidden-field secret's qid, kept only so this suite can
    assert that a value posted there now has no effect whatsoever. */
const RETIRED_ARRANGEMENT_AUTH_QID = '275';

/** Real Jotform submission ids are numeric (observed: 19 digits), and the
    handler shape-checks them before spending an API call, so these are
    numeric rather than the readable slugs this suite used previously. */
const SUB = {
  authOk: '1000000000000000001',
  matched: '1000000000000000002',
  wrongLinkQid: '1000000000000000003',
  nameIrrelevant: '1000000000000000004',
  noCaseCreated: '1000000000000000005',
  noToken: '1000000000000000006',
  badToken: '1000000000000000007',
  staleLinkToken: '1000000000000000008',
  minimization: '1000000000000000009',
  duplicate: '1000000000000000010',
  progression: '1000000000000000011',
  progressionIncomplete: '1000000000000000012',
  oversized: '1000000000000000013',
  huge: '1000000000000000014',
  forgedAnswers: '1000000000000000015',
  forgedLinkToken: '1000000000000000016',
  crossForm: '1000000000000000017',
  tooOld: '1000000000000000018',
  unknownToJotform: '1000000000000000019',
  providerDown: '1000000000000000020',
  badTimestamp: '1000000000000000021',
};

/** Jotform's own `created_at` serialization: `YYYY-MM-DD HH:MM:SS`, with
    no timezone offset (verified against the live API). */
function jotformTimestamp(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Registers what Jotform's authenticated API will report for one
 * submission. This is the authoritative record the handler reads; the POST
 * body's own `rawRequest` is deliberately NOT how answers get here.
 */
function givenJotformHasSubmission(params: {
  formId: string;
  submissionId: string;
  /** A plain string for a simple question, or a sub-keyed object for a
      compound one (e.g. a name's `{ first, last }`) — the same two shapes
      `GET /submission/{id}` itself returns. */
  answers?: Record<string, string | Record<string, string>>;
  submittedAt?: string | null;
}) {
  const answers: Record<string, { answer: string | Record<string, string> }> = {};
  for (const [qid, value] of Object.entries(params.answers ?? {})) answers[qid] = { answer: value };
  submissionApiRecords.set(params.submissionId, {
    formId: params.formId,
    submittedAt: params.submittedAt === undefined ? jotformTimestamp() : params.submittedAt,
    answers,
  });
}

/** Built as an explicit `application/x-www-form-urlencoded` body rather
    than a `FormData` object — jsdom's `Request` (this suite's test
    environment) does not correctly infer the multipart content-type from
    a `FormData` body, which breaks `request.formData()` on the receiving
    end. An explicit urlencoded body with an explicit Content-Type header
    parses identically through `request.formData()` (both are valid
    submitted-form encodings) and is itself a real, documented shape
    Jotform's webhook may use — this is not a test-only shortcut. */
function webhookRequest(fields: Record<string, string>, headers: Record<string, string> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) params.set(key, value);
  return new Request('http://localhost/api/webhooks/jotform', {
    method: 'POST',
    body: params.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
  });
}

let caseFormLinkLengthBefore: number;
let submissionLengthBefore: number;
let activityLengthBefore: number;
let configLengthBefore: number;

beforeEach(() => {
  process.env.JOTFORM_API_KEY = 'test-api-key';
  submissionApiRecords.clear();
  caseFormLinkLengthBefore = caseFormLinkFixtures.length;
  submissionLengthBefore = externalFormSubmissionFixtures.length;
  activityLengthBefore = activityEventFixtures.length;
  configLengthBefore = externalFormConfigFixtures.length;
});
afterEach(() => {
  delete process.env.JOTFORM_API_KEY;
  submissionApiRecords.clear();
  caseFormLinkFixtures.length = caseFormLinkLengthBefore;
  externalFormSubmissionFixtures.length = submissionLengthBefore;
  activityEventFixtures.length = activityLengthBefore;
  externalFormConfigFixtures.length = configLengthBefore;
  vi.clearAllMocks();
});

describe('POST /api/webhooks/jotform — server-side authentication against Jotform', () => {
  it('accepts a delivery whose submission Jotform confirms exists on the claimed form', async () => {
    givenJotformHasSubmission({ formId: VITAL_STATISTICS_FORM_ID, submissionId: SUB.authOk });
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: SUB.authOk }));
    expect(response.status).toBe(200);
  });

  it('rejects (401) a delivery for a submission Jotform will not return — a forged body cannot invent a submission', async () => {
    // Nothing registered: the live API answers 401 for a submission this
    // account does not own, so reachability through our own API key is
    // itself the proof of provenance.
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: SUB.unknownToJotform }),
    );
    expect(response.status).toBe(401);
    expect(externalFormSubmissionFixtures.length).toBe(submissionLengthBefore);
  });

  it('rejects (401) a genuine submission id delivered as a DIFFERENT form than Jotform reports', async () => {
    // A real Arrangement Forms submission, replayed as though it were a
    // Vital Statistics submission. Jotform's own `form_id` is decisive.
    givenJotformHasSubmission({ formId: ARRANGEMENT_FORMS_FORM_ID, submissionId: SUB.crossForm });
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: SUB.crossForm }));
    expect(response.status).toBe(401);
    expect(externalFormSubmissionFixtures.length).toBe(submissionLengthBefore);
  });

  it('rejects (401) a non-numeric submission id without spending an API call', async () => {
    const { POST } = await import('./route');
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    const response = await POST(
      webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: 'not-a-real-submission-id' }),
    );
    expect(response.status).toBe(401);
    expect(fetchSubmissionAnswers).not.toHaveBeenCalled();
  });

  it('rejects (401) a submission far older than the historical-replay bound', async () => {
    // Bounds an attacker walking backwards through this account's own
    // submission history to force bulk ingestion of old submissions.
    givenJotformHasSubmission({
      formId: VITAL_STATISTICS_FORM_ID,
      submissionId: SUB.tooOld,
      submittedAt: jotformTimestamp(-10 * 24 * 60 * 60 * 1000),
    });
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: SUB.tooOld }));
    expect(response.status).toBe(401);
    expect(externalFormSubmissionFixtures.length).toBe(submissionLengthBefore);
  });

  it('accepts a submission whose offset-less timestamp is displaced by a plausible account timezone', async () => {
    // Jotform's `created_at` carries no timezone, so a legitimate fresh
    // submission can read hours away from server time. That must not be
    // mistaken for a replay.
    givenJotformHasSubmission({
      formId: VITAL_STATISTICS_FORM_ID,
      submissionId: SUB.authOk,
      submittedAt: jotformTimestamp(-8 * 60 * 60 * 1000),
    });
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: SUB.authOk }));
    expect(response.status).toBe(200);
  });

  it('rejects (401) a submission whose timestamp Jotform did not supply or that cannot be parsed', async () => {
    givenJotformHasSubmission({ formId: VITAL_STATISTICS_FORM_ID, submissionId: SUB.badTimestamp, submittedAt: null });
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: SUB.badTimestamp }));
    expect(response.status).toBe(401);
  });

  it('answers 503 (retryable) rather than 401 when Jotform itself cannot be reached, so a genuine delivery is not lost', async () => {
    const { fetchSubmissionAnswers, JotformClientError } = await import('@/lib/jotform/jotformClient');
    vi.mocked(fetchSubmissionAnswers).mockRejectedValueOnce(
      new JotformClientError('Network error contacting Jotform.', 'network_error'),
    );
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: SUB.providerDown }));
    expect(response.status).toBe(503);
    expect(externalFormSubmissionFixtures.length).toBe(submissionLengthBefore);
  });

  it('answers 503 when JOTFORM_API_KEY is not configured — fails closed, never open', async () => {
    const { fetchSubmissionAnswers, JotformClientError } = await import('@/lib/jotform/jotformClient');
    vi.mocked(fetchSubmissionAnswers).mockRejectedValueOnce(
      new JotformClientError('JOTFORM_API_KEY is not configured.', 'missing_api_key'),
    );
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: SUB.providerDown }));
    expect(response.status).toBe(503);
  });

  it('a value at the retired solisWebhookAuth qid has no effect — the hidden-field secret is no longer consulted', async () => {
    // Deliberately absent from the body AND present-but-wrong in a second
    // delivery: both must behave identically, because the field is dead.
    givenJotformHasSubmission({ formId: ARRANGEMENT_FORMS_FORM_ID, submissionId: SUB.authOk });
    const { POST } = await import('./route');

    const withoutField = await POST(
      webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: SUB.authOk }),
    );
    expect(withoutField.status).toBe(200);

    givenJotformHasSubmission({ formId: ARRANGEMENT_FORMS_FORM_ID, submissionId: SUB.matched });
    const withGarbageField = await POST(
      webhookRequest({
        formID: ARRANGEMENT_FORMS_FORM_ID,
        submissionID: SUB.matched,
        rawRequest: JSON.stringify({ [`${RETIRED_ARRANGEMENT_AUTH_QID}_soliswebhookauth`]: 'any-forged-value' }),
      }),
    );
    expect(withGarbageField.status).toBe(200);
  });

  it('never echoes submission content or identifiers beyond a safe reason code in a rejection body', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: VITAL_STATISTICS_FORM_ID,
        submissionID: SUB.unknownToJotform,
        rawRequest: JSON.stringify({ q3_name: 'Forged Decedent', [`${RETIRED_ARRANGEMENT_AUTH_QID}_a`]: 'forged-secret' }),
      }),
    );
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain('Forged Decedent');
    expect(serialized).not.toContain('forged-secret');
    expect(serialized).not.toContain('test-api-key');
  });
});

describe('POST /api/webhooks/jotform — the request body is never trusted as data', () => {
  it('ignores forged answers in the body and persists only what Jotform reports', async () => {
    givenJotformHasSubmission({
      formId: VITAL_STATISTICS_FORM_ID,
      submissionId: SUB.forgedAnswers,
      answers: { '3': { first: 'Authoritative', last: 'Decedent' } },
    });

    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: VITAL_STATISTICS_FORM_ID,
        submissionID: SUB.forgedAnswers,
        rawRequest: JSON.stringify({ q3_nameof: { first: 'Forged', last: 'DecedentByAttacker' } }),
      }),
    );

    expect(response.status).toBe(200);
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.forgedAnswers);
    expect(submission?.mappedFields).toContain('Authoritative Decedent');
    expect(submission?.mappedFields).not.toContain('DecedentByAttacker');
  });

  it('ignores a link token forged into the body — a genuine submission cannot be attached to a case of the attacker\'s choosing', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { rawToken } = await generateLinkForSending(
      'managed-cremations',
      'case-webhook-forged-link',
      'jotform',
      ARRANGEMENT_FORMS_FORM_CONFIG_ID,
      'mock',
    );

    // Jotform reports NO link token for this submission; the attacker
    // supplies a real one in the body. The body must lose.
    givenJotformHasSubmission({ formId: ARRANGEMENT_FORMS_FORM_ID, submissionId: SUB.forgedLinkToken });

    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: ARRANGEMENT_FORMS_FORM_ID,
        submissionID: SUB.forgedLinkToken,
        rawRequest: JSON.stringify({ [`${ARRANGEMENT_LINK_QID}_solislinktoken`]: rawToken }),
      }),
    );

    expect(response.status).toBe(200);
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.forgedLinkToken);
    expect(submission?.status).toBe('unmatched');
    const link = caseFormLinkFixtures.find((l) => l.caseId === 'case-webhook-forged-link');
    expect(link?.status).not.toBe('received');
  });
});

describe('POST /api/webhooks/jotform — body size limits', () => {
  it('rejects an oversized payload via a Content-Length precheck before any parsing', async () => {
    givenJotformHasSubmission({ formId: VITAL_STATISTICS_FORM_ID, submissionId: SUB.oversized });
    const { POST } = await import('./route');
    const oversizedRequest = webhookRequest(
      { formID: VITAL_STATISTICS_FORM_ID, submissionID: SUB.oversized },
      { 'Content-Length': String(10 * 1024 * 1024) },
    );
    const response = await POST(oversizedRequest);
    expect(response.status).toBe(413);
  });

  it('rejects an oversized payload via the aggregate-size fallback when Content-Length is absent/understated', async () => {
    givenJotformHasSubmission({ formId: VITAL_STATISTICS_FORM_ID, submissionId: SUB.huge });
    const { POST } = await import('./route');
    const hugeValue = 'x'.repeat(3 * 1024 * 1024);
    const response = await POST(
      webhookRequest({
        formID: VITAL_STATISTICS_FORM_ID,
        submissionID: SUB.huge,
        rawRequest: JSON.stringify({ bloat: hugeValue }),
      }),
    );
    expect(response.status).toBe(413);
  });
});

describe('POST /api/webhooks/jotform — malformed / unknown / disabled', () => {
  it('rejects a malformed payload missing formID/submissionID before any config or API resolution', async () => {
    const { POST } = await import('./route');
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    const response = await POST(webhookRequest({ somethingElse: 'x' }));
    expect(response.status).toBe(400);
    expect(fetchSubmissionAnswers).not.toHaveBeenCalled();
  });

  it('rejects (404) an unknown/unallowlisted form id — no API call, no submission row created', async () => {
    const { POST } = await import('./route');
    const { fetchSubmissionAnswers } = await import('@/lib/jotform/jotformClient');
    const response = await POST(webhookRequest({ formID: 'unknown-form-id-999', submissionID: SUB.authOk }));
    expect(response.status).toBe(404);
    expect(fetchSubmissionAnswers).not.toHaveBeenCalled();
    expect(externalFormSubmissionFixtures.length).toBe(submissionLengthBefore);
  });

  it('rejects (404) a disabled form config exactly like an unknown one — no submission row created', async () => {
    externalFormConfigFixtures.push({
      id: 'extform-config-disabled-test',
      organizationId: 'managed-cremations',
      provider: 'jotform',
      externalFormId: 'disabled-form-id-123',
      label: 'Disabled Test Form',
      audience: 'staff',
      purpose: 'case_update',
      fieldMap: '{}',
      linkTokenFieldName: 'solisLinkToken',
      linkTokenFieldQid: '1',
      webhookAuthFieldQid: '2',
      isEnabled: false,
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
    });
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: 'disabled-form-id-123', submissionID: SUB.authOk }));
    expect(response.status).toBe(404);
    expect(externalFormSubmissionFixtures.length).toBe(submissionLengthBefore);
  });
});

describe('POST /api/webhooks/jotform — matched submission', () => {
  it('resolves the case via the opaque token read from Jotform at its trusted qid, stores the submission as matched, and marks the CaseFormLink received', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { rawToken } = await generateLinkForSending('managed-cremations', 'case-webhook-1', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');

    givenJotformHasSubmission({
      formId: ARRANGEMENT_FORMS_FORM_ID,
      submissionId: SUB.matched,
      answers: { [ARRANGEMENT_LINK_QID]: rawToken, '1': 'B2026-034' },
    });

    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: SUB.matched }));

    expect(response.status).toBe(200);
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.matched);
    expect(submission?.status).toBe('matched');
    const link = caseFormLinkFixtures.find((l) => l.caseId === 'case-webhook-1');
    expect(link?.status).toBe('received');
    expect(link?.submissionId).toBe(submission?.id);
  });

  it('a link token present at the WRONG qid never links — the submission lands unmatched', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { rawToken } = await generateLinkForSending('managed-cremations', 'case-webhook-wrong-link-qid', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');

    // Token reported at Vital Statistics' link-token qid (44), not
    // Arrangement Forms' own (274) — must never resolve.
    givenJotformHasSubmission({
      formId: ARRANGEMENT_FORMS_FORM_ID,
      submissionId: SUB.wrongLinkQid,
      answers: { [VITAL_LINK_QID]: rawToken },
    });

    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: SUB.wrongLinkQid }));
    expect(response.status).toBe(200);
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.wrongLinkQid);
    expect(submission?.status).toBe('unmatched');
  });

  it('never creates a case and never touches caseSequences for a matched submission', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { rawToken } = await generateLinkForSending('managed-cremations', 'case-webhook-2', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');
    const { caseFixtures } = await import('@/services/__mocks__/fixtures');
    const casesBefore = caseFixtures.length;

    givenJotformHasSubmission({
      formId: ARRANGEMENT_FORMS_FORM_ID,
      submissionId: SUB.noCaseCreated,
      answers: { [ARRANGEMENT_LINK_QID]: rawToken },
    });

    const { POST } = await import('./route');
    await POST(webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: SUB.noCaseCreated }));

    expect(caseFixtures.length).toBe(casesBefore);
  });
});

describe('POST /api/webhooks/jotform — unmatched submission', () => {
  it('stores the submission as unmatched when Jotform reports no token', async () => {
    givenJotformHasSubmission({ formId: VITAL_STATISTICS_FORM_ID, submissionId: SUB.noToken });
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: SUB.noToken }));
    expect(response.status).toBe(200);
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.noToken);
    expect(submission?.status).toBe('unmatched');
    expect(submission?.caseFormLinkId).toBeNull();
  });

  it('stores the submission as unmatched — and NOT as an authentication failure — when the token does not resolve to any CaseFormLink', async () => {
    givenJotformHasSubmission({
      formId: VITAL_STATISTICS_FORM_ID,
      submissionId: SUB.badToken,
      answers: { [VITAL_LINK_QID]: 'never-issued-token-xyz' },
    });
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: SUB.badToken }));
    // An unresolvable link token is authenticated-but-unmatched — 200,
    // never 401. Authentication and linkage are fully independent.
    expect(response.status).toBe(200);
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.badToken);
    expect(submission?.status).toBe('unmatched');
  });

  it("regenerating a CaseFormLink's link token leaves authentication unaffected — a stale token is unmatched, not unauthenticated", async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const first = await generateLinkForSending('managed-cremations', 'case-webhook-regen', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');
    const regenerated = await generateLinkForSending('managed-cremations', 'case-webhook-regen', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');
    expect(regenerated.rawToken).not.toBe(first.rawToken);

    givenJotformHasSubmission({
      formId: ARRANGEMENT_FORMS_FORM_ID,
      submissionId: SUB.staleLinkToken,
      answers: { [ARRANGEMENT_LINK_QID]: first.rawToken },
    });

    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: SUB.staleLinkToken }));
    expect(response.status).toBe(200);
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.staleLinkToken);
    expect(submission?.status).toBe('unmatched');
  });
});

describe('POST /api/webhooks/jotform — data minimization', () => {
  it('never persists a full rawPayload or the raw solisLinkToken on the stored submission', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { rawToken } = await generateLinkForSending('managed-cremations', 'case-webhook-minimization', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');

    givenJotformHasSubmission({
      formId: ARRANGEMENT_FORMS_FORM_ID,
      submissionId: SUB.minimization,
      answers: { [ARRANGEMENT_LINK_QID]: rawToken, '1': 'B2026-034' },
    });

    const { POST } = await import('./route');
    await POST(webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: SUB.minimization }));

    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.minimization);
    expect(submission).toBeDefined();
    expect(submission).not.toHaveProperty('rawPayload');
    const serialized = JSON.stringify(submission);
    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toContain('test-api-key');
  });
});

describe('POST /api/webhooks/jotform — idempotency', () => {
  it('a duplicate webhook delivery never creates a second submission row or a second CaseFormLink transition', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { rawToken } = await generateLinkForSending('managed-cremations', 'case-webhook-3', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');

    givenJotformHasSubmission({
      formId: ARRANGEMENT_FORMS_FORM_ID,
      submissionId: SUB.duplicate,
      answers: { [ARRANGEMENT_LINK_QID]: rawToken },
    });

    const { POST } = await import('./route');
    const { upload } = await import('@/services/documentService');

    await POST(webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: SUB.duplicate }));
    await POST(webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: SUB.duplicate }));

    const matching = externalFormSubmissionFixtures.filter((s) => s.externalSubmissionId === SUB.duplicate);
    expect(matching).toHaveLength(1);
    // PDF preservation (and its upload call) only ever runs once — the
    // redelivery short-circuits before reaching it.
    expect(upload).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/webhooks/jotform — organization isolation', () => {
  it('a token generated for one organization never resolves for a differently-scoped lookup', async () => {
    const { generateLinkForSending, resolveByRawToken } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { rawToken } = await generateLinkForSending('org-isolated-a', 'case-iso-a', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');

    const resolved = await resolveByRawToken(rawToken, 'mock');
    expect(resolved?.organizationId).toBe('org-isolated-a');
    expect(resolved?.organizationId).not.toBe('managed-cremations');
  });
});

describe('POST /api/webhooks/jotform — workflow progression (Task #1, 2026-09)', () => {
  const seededCaseIds: string[] = [];
  afterEach(async () => {
    const { caseFixtures } = await import('@/services/__mocks__/fixtures');
    for (const id of seededCaseIds.splice(0)) {
      const index = caseFixtures.findIndex((c) => c.id === id);
      if (index !== -1) caseFixtures.splice(index, 1);
    }
  });

  /** A case with "First Call & Payment" fully complete but not yet past
      it — the exact "normal live case, Arrangement Forms about to
      complete" scenario this checkpoint's staff walkthrough reported as
      stuck. Mirrors services/workflowReconciliationService.test.ts's own
      buildTestCase/fullyCompleteFirstCallAndPayment helpers. */
  async function seedCaseReadyForArrangementForms(id: string) {
    const { caseFixtures, DEFAULT_ORGANIZATION_ID } = await import('@/services/__mocks__/fixtures');
    const { standardCremationWorkflowTemplateFixture } = await import('@/services/__mocks__/workflowTemplates');
    const { buildCaseWorkflowSnapshot } = await import('@/domain/workflow/snapshot');
    const version = standardCremationWorkflowTemplateFixture.versions[0];
    const case_ = {
      id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseNumber: 'B2026-901',
      decedentName: 'Webhook Progression Test',
      dateOfBirth: '01/01/1950',
      dateOfDeath: '01/01/2026',
      timeOfDeath: '10:00',
      placeOfDeath: 'Test Hospital',
      weight: '150 lb',
      rawStage: 0,
      assignedStaffId: null,
      nextOfKinName: 'Test NOK',
      nextOfKinPhone: '555-0100',
      nextOfKinEmail: null,
      nextOfKinRelationship: null,
      nextOfKinRelationshipOther: null,
      certifierName: null,
      certifierPhone: null,
      certifierLicenseNumber: null,
      certifierFax: null,
      tagNumber: null,
      paymentStatus: 'awaiting_payment' as const,
      pickupStatus: 'awaiting_pickup' as const,
      pickupReleasedTo: null,
      pickupReleasedAt: null,
      pickupNote: null,
      returnMethod: 'undecided' as const,
      shippingCarrier: null,
      shippingTrackingNumber: null,
      shippingDateShipped: null,
      shippingDeliveryStatus: null,
      shippingDeliveredAt: null,
      isVeteran: false,
      vaStepsState: {},
      vaPublishChoice: null,
      vaNotificationResponsibility: null,
      // Every hasField index in "First Call & Payment" filled in, plus the
      // manual "Payment collected"/"Credit card.../Payment receipt sent"
      // checkboxes explicitly checked — the stage is genuinely, fully done.
      // displayStage 0 — composite-keyed per B2026-035's fix
      // (domain/workflow/checklistItemKey.ts). Checklist default-done fix
      // (2026-10): displayStage 0 is ALSO represented by a second,
      // rawStage-1 StageTemplate whose SAME local indices 0-7 are manual
      // (not hasField), so they need an explicit composite key too — not
      // just the historical 8/9/10.
      checklistState: {
        '0:0': true,
        '0:1': true,
        '0:2': true,
        '0:3': true,
        '0:4': true,
        '0:5': true,
        '0:6': true,
        '0:7': true,
        '0:8': true,
        '0:9': true,
        '0:10': true,
      },
      fieldValues: { 0: 'X', 1: 'X', 2: 'X', 3: 'X', 4: 'X', 5: 'X', 6: 'X', 7: 'X', 9: 'X', 10: 'X' },
      daysWaitingInStage: 0,
      isStalled: false,
      stalledReason: null,
      createdBy: null,
      intakeOwnerId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      isDeleted: false,
      workflowTemplateId: standardCremationWorkflowTemplateFixture.id,
      workflowTemplateVersion: version.version,
      caseType: 'cremation',
      workflowSnapshot: buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, version),
    };
    caseFixtures.push(case_);
    return case_;
  }

  it('1: a normal live case whose Arrangement Form submission arrives via webhook advances to the actual first incomplete stage (EDRS, rawStage 3) — never a hardcoded 3', async () => {
    const { caseFixtures } = await import('@/services/__mocks__/fixtures');
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const caseId = 'case-webhook-progression-1';
    await seedCaseReadyForArrangementForms(caseId);
    seededCaseIds.push(caseId);
    const casesBefore = caseFixtures.length;

    const { rawToken } = await generateLinkForSending('managed-cremations', caseId, 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');

    givenJotformHasSubmission({
      formId: ARRANGEMENT_FORMS_FORM_ID,
      submissionId: SUB.progression,
      answers: { [ARRANGEMENT_LINK_QID]: rawToken },
    });

    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: SUB.progression }));

    expect(response.status).toBe(200);
    const updated = caseFixtures.find((c) => c.id === caseId);
    expect(updated?.rawStage).toBe(3); // "EDRS & Doctor / Cause of Death" — the actual first incomplete stage, computed, not assumed
    expect(caseFixtures.length).toBe(casesBefore); // no case created/duplicated by this webhook
  });

  it("does not advance a case whose First Call & Payment prerequisites are genuinely incomplete, even once its Arrangement Form arrives", async () => {
    const { caseFixtures, DEFAULT_ORGANIZATION_ID } = await import('@/services/__mocks__/fixtures');
    const { standardCremationWorkflowTemplateFixture } = await import('@/services/__mocks__/workflowTemplates');
    const { buildCaseWorkflowSnapshot } = await import('@/domain/workflow/snapshot');
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const version = standardCremationWorkflowTemplateFixture.versions[0];
    const caseId = 'case-webhook-progression-incomplete';
    caseFixtures.push({
      id: caseId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseNumber: 'B2026-902',
      decedentName: 'Incomplete Prerequisite Test',
      dateOfBirth: '01/01/1950',
      dateOfDeath: '01/01/2026',
      timeOfDeath: '10:00',
      placeOfDeath: 'Test Hospital',
      weight: '150 lb',
      rawStage: 0,
      assignedStaffId: null,
      nextOfKinName: 'Test NOK',
      nextOfKinPhone: '555-0100',
      nextOfKinEmail: null,
      nextOfKinRelationship: null,
      nextOfKinRelationshipOther: null,
      certifierName: null,
      certifierPhone: null,
      certifierLicenseNumber: null,
      certifierFax: null,
      tagNumber: null,
      paymentStatus: 'awaiting_payment',
      pickupStatus: 'awaiting_pickup',
      pickupReleasedTo: null,
      pickupReleasedAt: null,
      pickupNote: null,
      returnMethod: 'undecided',
      shippingCarrier: null,
      shippingTrackingNumber: null,
      shippingDateShipped: null,
      shippingDeliveryStatus: null,
      shippingDeliveredAt: null,
      isVeteran: false,
      vaStepsState: {},
      vaPublishChoice: null,
      vaNotificationResponsibility: null,
      checklistState: {}, // nothing confirmed — "Payment collected" etc. still outstanding
      fieldValues: {}, // nothing filled in — weight/dateOfBirth/etc. genuinely unknown
      daysWaitingInStage: 0,
      isStalled: false,
      stalledReason: null,
      createdBy: null,
      intakeOwnerId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      isDeleted: false,
      workflowTemplateId: standardCremationWorkflowTemplateFixture.id,
      workflowTemplateVersion: version.version,
      caseType: 'cremation',
      workflowSnapshot: buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, version),
    });
    seededCaseIds.push(caseId);

    const { rawToken } = await generateLinkForSending('managed-cremations', caseId, 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');

    givenJotformHasSubmission({
      formId: ARRANGEMENT_FORMS_FORM_ID,
      submissionId: SUB.progressionIncomplete,
      answers: { [ARRANGEMENT_LINK_QID]: rawToken },
    });

    const { POST } = await import('./route');
    await POST(webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: SUB.progressionIncomplete }));

    const updated = caseFixtures.find((c) => c.id === caseId);
    expect(updated?.rawStage).toBe(0); // still blocked — First Call & Payment was never actually completed
  });
});

describe('POST /api/webhooks/jotform — cross-tenant and retirement safety', () => {
  it('14. a link token belonging to ANOTHER organization never attaches — the submission lands unmatched', async () => {
    // `resolveByRawToken` looks up by token hash with no org filter, so the
    // handler's own organization guard is what prevents a cross-tenant
    // write. Driven through the real handler, not the service.
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { rawToken } = await generateLinkForSending(
      'org-some-other-tenant',
      'case-belonging-to-another-tenant',
      'jotform',
      ARRANGEMENT_FORMS_FORM_CONFIG_ID,
      'mock',
    );

    givenJotformHasSubmission({
      formId: ARRANGEMENT_FORMS_FORM_ID,
      submissionId: SUB.crossForm,
      answers: { [ARRANGEMENT_LINK_QID]: rawToken },
    });

    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: SUB.crossForm }));

    expect(response.status).toBe(200);
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.crossForm);
    // Filed under the FORM's organization (from the trusted config row),
    // never the token's.
    expect(submission?.organizationId).toBe('managed-cremations');
    expect(submission?.status).toBe('unmatched');
    expect(submission?.caseFormLinkId).toBeNull();
    // And the other tenant's link was never touched.
    const foreignLink = caseFormLinkFixtures.find((l) => l.caseId === 'case-belonging-to-another-tenant');
    expect(foreignLink?.status).not.toBe('received');
  });

  it('17. a retired test submission cannot be resurrected by a webhook redelivery', async () => {
    // The production tombstone shape: the row still exists, carries a
    // non-null `createdCaseId` sentinel and `status: 'reviewed'`, and its
    // mapped data has been cleared. A redelivery must be a pure no-op —
    // the `wasNew` gate returns before any create branch is reached.
    const { externalFormSubmissionFixtures: rows } = await import('@/services/__mocks__/externalFormFixtures');
    rows.push({
      id: `managed-cremations-jotform-${SUB.unknownToJotform}`,
      organizationId: 'managed-cremations',
      provider: 'jotform',
      externalFormId: ARRANGEMENT_FORMS_FORM_ID,
      externalSubmissionId: SUB.unknownToJotform,
      caseFormLinkId: null,
      status: 'reviewed',
      mappedFields: '{}',
      receivedAt: '2026-10-08T20:49:23.312Z',
      reviewedAt: '2026-10-09T00:00:00.000Z',
      reviewedBy: 'administrative-cleanup',
      createdCaseId: 'RETIRED-INTEGRATION-TEST',
      pdfStatus: 'not_applicable',
      documentId: null,
      pdfFailureReason: null,
      updatedAt: '2026-10-09T00:00:00.000Z',
    } as never);

    givenJotformHasSubmission({ formId: ARRANGEMENT_FORMS_FORM_ID, submissionId: SUB.unknownToJotform });

    const { POST } = await import('./route');
    const before = externalFormSubmissionFixtures.length;
    const response = await POST(
      webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: SUB.unknownToJotform }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(externalFormSubmissionFixtures.length).toBe(before);
    const row = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === SUB.unknownToJotform);
    expect(row?.createdCaseId).toBe('RETIRED-INTEGRATION-TEST');
    expect(row?.status).toBe('reviewed');
    expect(row?.mappedFields).toBe('{}');
  });
});
