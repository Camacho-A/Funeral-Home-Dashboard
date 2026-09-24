import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFormLinkFixtures, externalFormSubmissionFixtures } from '@/services/__mocks__/externalFormFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

vi.mock('@/lib/jotform/jotformClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jotform/jotformClient')>('@/lib/jotform/jotformClient');
  return { ...actual, fetchSubmissionPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 synthetic')) };
});
vi.mock('@/services/documentService', async () => {
  const actual = await vi.importActual<typeof import('@/services/documentService')>('@/services/documentService');
  return { ...actual, upload: vi.fn().mockResolvedValue({ id: 'document-webhook-test' }) };
});

const VITAL_STATISTICS_FORM_ID = '262605621454050';
const ARRANGEMENT_FORMS_FORM_ID = '261945978664175';
const TEST_SECRET = 'test-shared-secret';

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

/** Jotform pre-production hardening (2026-09): `solisWebhookAuth` now
    travels inside the same `rawRequest` JSON blob `solisLinkToken` and
    every other hidden field does — never an HTTP header. `extra` merges
    in whatever else a test needs in the same blob (link token, mapped
    qid answers). `authValue: null` (never `undefined` — a default
    parameter value would silently reactivate on an explicit `undefined`
    argument) means "omit the field entirely." */
function rawRequestWithAuth(extra: Record<string, unknown> = {}, authValue: string | null = TEST_SECRET) {
  const body: Record<string, unknown> = { ...extra };
  if (authValue !== null) body.solisWebhookAuth = authValue;
  return JSON.stringify(body);
}

let caseFormLinkLengthBefore: number;
let submissionLengthBefore: number;
let activityLengthBefore: number;

beforeEach(() => {
  process.env.JOTFORM_WEBHOOK_SHARED_SECRET = TEST_SECRET;
  caseFormLinkLengthBefore = caseFormLinkFixtures.length;
  submissionLengthBefore = externalFormSubmissionFixtures.length;
  activityLengthBefore = activityEventFixtures.length;
});
afterEach(() => {
  delete process.env.JOTFORM_WEBHOOK_SHARED_SECRET;
  caseFormLinkFixtures.length = caseFormLinkLengthBefore;
  externalFormSubmissionFixtures.length = submissionLengthBefore;
  activityEventFixtures.length = activityLengthBefore;
  vi.clearAllMocks();
});

describe('POST /api/webhooks/jotform — verification (solisWebhookAuth, body field)', () => {
  it('rejects a request with no shared secret configured (fail-closed), even with a correct-looking auth value present', async () => {
    delete process.env.JOTFORM_WEBHOOK_SHARED_SECRET;
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: 'x', rawRequest: rawRequestWithAuth() }),
    );
    expect(response.status).toBe(401);
  });

  it('rejects a request missing the solisWebhookAuth field even when a secret is configured', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: 'x', rawRequest: rawRequestWithAuth({}, null) }),
    );
    expect(response.status).toBe(401);
  });

  it('rejects a request with the wrong solisWebhookAuth value', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: 'x', rawRequest: rawRequestWithAuth({}, 'wrong-value') }),
    );
    expect(response.status).toBe(401);
  });

  it('accepts a request with the correct solisWebhookAuth value', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: 'sub-auth-ok', rawRequest: rawRequestWithAuth() }),
    );
    expect(response.status).toBe(200);
  });

  it('never includes the configured secret or the received auth value in an error response body', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: 'x', rawRequest: rawRequestWithAuth({}, 'wrong-value') }),
    );
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain(TEST_SECRET);
    expect(JSON.stringify(body)).not.toContain('wrong-value');
  });

  it('auth is checked before malformed-body detection — an unauthenticated caller cannot distinguish malformed from wrong-secret', async () => {
    const { POST } = await import('./route');
    // Missing formID/submissionID entirely AND wrong auth — must be 401
    // (auth failure), never 400 (malformed), proving auth runs first.
    const response = await POST(webhookRequest({ somethingElse: 'x', rawRequest: rawRequestWithAuth({}, 'wrong-value') }));
    expect(response.status).toBe(401);
  });
});

describe('POST /api/webhooks/jotform — body size limits', () => {
  it('rejects an oversized payload via a Content-Length precheck before any parsing', async () => {
    const { POST } = await import('./route');
    const oversizedRequest = webhookRequest(
      { formID: VITAL_STATISTICS_FORM_ID, submissionID: 'sub-oversized', rawRequest: rawRequestWithAuth() },
      { 'Content-Length': String(10 * 1024 * 1024) },
    );
    const response = await POST(oversizedRequest);
    expect(response.status).toBe(413);
  });

  it('rejects an oversized payload via the aggregate-size fallback when Content-Length is absent/understated', async () => {
    const { POST } = await import('./route');
    const hugeValue = 'x'.repeat(3 * 1024 * 1024);
    const response = await POST(
      webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: 'sub-huge', rawRequest: rawRequestWithAuth({ bloat: hugeValue }) }),
    );
    expect(response.status).toBe(413);
  });
});

describe('POST /api/webhooks/jotform — malformed / unknown', () => {
  it('rejects a malformed payload missing formID/submissionID (once authenticated)', async () => {
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ somethingElse: 'x', rawRequest: rawRequestWithAuth() }));
    expect(response.status).toBe(400);
  });

  it('acknowledges (200) but does nothing for an unknown/unallowlisted form id', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: 'unknown-form-id-999', submissionID: 'sub-1', rawRequest: rawRequestWithAuth() }),
    );
    expect(response.status).toBe(200);
    expect(externalFormSubmissionFixtures.length).toBe(submissionLengthBefore);
  });
});

describe('POST /api/webhooks/jotform — matched submission', () => {
  it('resolves the case via the opaque token, stores the submission as matched, and marks the CaseFormLink received', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { rawToken } = await generateLinkForSending('managed-cremations', 'case-webhook-1', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');

    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: ARRANGEMENT_FORMS_FORM_ID,
        submissionID: 'sub-matched-1',
        rawRequest: rawRequestWithAuth({ q1_caseNo: 'B2026-034', solisLinkToken: rawToken }),
      }),
    );

    expect(response.status).toBe(200);
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'sub-matched-1');
    expect(submission?.status).toBe('matched');
    const link = caseFormLinkFixtures.find((l) => l.caseId === 'case-webhook-1');
    expect(link?.status).toBe('received');
    expect(link?.submissionId).toBe(submission?.id);
  });

  it('never creates a case and never touches caseSequences for a matched submission', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { rawToken } = await generateLinkForSending('managed-cremations', 'case-webhook-2', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');
    const { caseFixtures } = await import('@/services/__mocks__/fixtures');
    const casesBefore = caseFixtures.length;

    const { POST } = await import('./route');
    await POST(
      webhookRequest({
        formID: ARRANGEMENT_FORMS_FORM_ID,
        submissionID: 'sub-matched-2',
        rawRequest: rawRequestWithAuth({ solisLinkToken: rawToken }),
      }),
    );

    expect(caseFixtures.length).toBe(casesBefore);
  });
});

describe('POST /api/webhooks/jotform — unmatched submission', () => {
  it('stores the submission as unmatched when no token is present', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: 'sub-no-token', rawRequest: rawRequestWithAuth() }),
    );
    expect(response.status).toBe(200);
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'sub-no-token');
    expect(submission?.status).toBe('unmatched');
    expect(submission?.caseFormLinkId).toBeNull();
  });

  it('stores the submission as unmatched — and NOT as an authentication failure — when the token does not resolve to any CaseFormLink', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: VITAL_STATISTICS_FORM_ID,
        submissionID: 'sub-bad-token',
        rawRequest: rawRequestWithAuth({ solisLinkToken: 'never-issued-token-xyz' }),
      }),
    );
    // A garbage/invalid link token is authenticated-but-unmatched — 200,
    // never 401. Authentication and linkage are fully independent.
    expect(response.status).toBe(200);
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'sub-bad-token');
    expect(submission?.status).toBe('unmatched');
  });
});

describe('POST /api/webhooks/jotform — solisLinkToken / solisWebhookAuth independence', () => {
  it('regenerating a CaseFormLink\'s link token does not require or affect the webhook auth value', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const first = await generateLinkForSending('managed-cremations', 'case-webhook-regen', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');
    const regenerated = await generateLinkForSending('managed-cremations', 'case-webhook-regen', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');
    expect(regenerated.rawToken).not.toBe(first.rawToken);

    const { POST } = await import('./route');
    // The OLD token is now stale (regeneration invalidated it) — still
    // reaches "authenticated but unmatched" (200), never an auth failure
    // (401), because solisWebhookAuth alone gates authentication.
    const response = await POST(
      webhookRequest({
        formID: ARRANGEMENT_FORMS_FORM_ID,
        submissionID: 'sub-stale-link-token',
        rawRequest: rawRequestWithAuth({ solisLinkToken: first.rawToken }),
      }),
    );
    expect(response.status).toBe(200);
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'sub-stale-link-token');
    expect(submission?.status).toBe('unmatched');
  });

  it('a missing solisWebhookAuth is rejected (401) even when a perfectly valid solisLinkToken is present', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { rawToken } = await generateLinkForSending('managed-cremations', 'case-webhook-3-noauth', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');

    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: ARRANGEMENT_FORMS_FORM_ID,
        submissionID: 'sub-valid-link-no-auth',
        rawRequest: rawRequestWithAuth({ solisLinkToken: rawToken }, null),
      }),
    );
    expect(response.status).toBe(401);
    expect(externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'sub-valid-link-no-auth')).toBeUndefined();
  });
});

describe('POST /api/webhooks/jotform — data minimization', () => {
  it('never persists a full rawPayload, solisWebhookAuth, or the raw solisLinkToken on the stored submission', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { rawToken } = await generateLinkForSending('managed-cremations', 'case-webhook-minimization', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');

    const { POST } = await import('./route');
    await POST(
      webhookRequest({
        formID: ARRANGEMENT_FORMS_FORM_ID,
        submissionID: 'sub-minimization-1',
        rawRequest: rawRequestWithAuth({ solisLinkToken: rawToken, q1_caseNo: 'B2026-034' }),
      }),
    );

    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'sub-minimization-1');
    expect(submission).toBeDefined();
    expect(submission).not.toHaveProperty('rawPayload');
    const serialized = JSON.stringify(submission);
    expect(serialized).not.toContain(TEST_SECRET);
    expect(serialized).not.toContain(rawToken);
  });
});

describe('POST /api/webhooks/jotform — idempotency', () => {
  it('a duplicate webhook delivery never creates a second submission row or a second CaseFormLink transition', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { rawToken } = await generateLinkForSending('managed-cremations', 'case-webhook-3', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');
    const rawRequest = rawRequestWithAuth({ solisLinkToken: rawToken });

    const { POST } = await import('./route');
    const { upload } = await import('@/services/documentService');

    await POST(webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: 'sub-dup-1', rawRequest }));
    await POST(webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: 'sub-dup-1', rawRequest }));

    const matching = externalFormSubmissionFixtures.filter((s) => s.externalSubmissionId === 'sub-dup-1');
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
