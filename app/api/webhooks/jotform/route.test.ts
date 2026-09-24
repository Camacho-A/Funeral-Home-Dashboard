import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFormLinkFixtures, externalFormSubmissionFixtures, externalFormConfigFixtures } from '@/services/__mocks__/externalFormFixtures';
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
const VITAL_LINK_QID = '44';
const VITAL_AUTH_QID = '45';
const ARRANGEMENT_FORMS_FORM_ID = '261945978664175';
const ARRANGEMENT_LINK_QID = '274';
const ARRANGEMENT_AUTH_QID = '275';
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

/** Jotform hidden-field identifier correction (2026-09): every hidden
    field is now located strictly by qid — `{qid}_{anyName}` — never by a
    fixed field name. `authValue: null` (never `undefined` — a default
    parameter value would silently reactivate on an explicit `undefined`
    argument) means "omit the auth field entirely." The name portion
    after the qid is deliberately arbitrary/unrealistic in most tests
    (`soliswebhookauth`) to make clear the parser never inspects it. */
function withAuth(authQid: string, extra: Record<string, unknown> = {}, authValue: string | null = TEST_SECRET) {
  const body: Record<string, unknown> = { ...extra };
  if (authValue !== null) body[`${authQid}_soliswebhookauth`] = authValue;
  return JSON.stringify(body);
}

/** A qid-prefixed link-token entry to merge into a `withAuth(...)` extra
    object — the name portion is deliberately generic, never assumed to
    be `solisLinkToken` on the wire. */
function linkTokenEntry(linkQid: string, token: string): Record<string, unknown> {
  return { [`${linkQid}_solislinktoken`]: token };
}

let caseFormLinkLengthBefore: number;
let submissionLengthBefore: number;
let activityLengthBefore: number;
let configLengthBefore: number;

beforeEach(() => {
  process.env.JOTFORM_WEBHOOK_SHARED_SECRET = TEST_SECRET;
  caseFormLinkLengthBefore = caseFormLinkFixtures.length;
  submissionLengthBefore = externalFormSubmissionFixtures.length;
  activityLengthBefore = activityEventFixtures.length;
  configLengthBefore = externalFormConfigFixtures.length;
});
afterEach(() => {
  delete process.env.JOTFORM_WEBHOOK_SHARED_SECRET;
  caseFormLinkFixtures.length = caseFormLinkLengthBefore;
  externalFormSubmissionFixtures.length = submissionLengthBefore;
  activityEventFixtures.length = activityLengthBefore;
  externalFormConfigFixtures.length = configLengthBefore;
  vi.clearAllMocks();
});

describe('POST /api/webhooks/jotform — verification (solisWebhookAuth, qid-driven)', () => {
  it('rejects a request with no shared secret configured (fail-closed), even with a correct-looking auth value present', async () => {
    delete process.env.JOTFORM_WEBHOOK_SHARED_SECRET;
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: 'x', rawRequest: withAuth(ARRANGEMENT_AUTH_QID) }),
    );
    expect(response.status).toBe(401);
  });

  it('rejects a request missing the solisWebhookAuth field even when a secret is configured', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: 'x', rawRequest: withAuth(ARRANGEMENT_AUTH_QID, {}, null) }),
    );
    expect(response.status).toBe(401);
  });

  it('rejects a request with the wrong solisWebhookAuth value', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: 'x', rawRequest: withAuth(ARRANGEMENT_AUTH_QID, {}, 'wrong-value') }),
    );
    expect(response.status).toBe(401);
  });

  it('accepts a request with the correct solisWebhookAuth value at the correct qid', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: 'sub-auth-ok', rawRequest: withAuth(VITAL_AUTH_QID) }),
    );
    expect(response.status).toBe(200);
  });

  it('a correct secret value present at the WRONG qid never authenticates', async () => {
    // The value is objectively correct, but posted under Arrangement
    // Forms' auth qid (275) while submitting to Vital Statistics (which
    // trusts qid 45) — must never authenticate.
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: 'sub-wrong-qid', rawRequest: withAuth(ARRANGEMENT_AUTH_QID) }),
    );
    expect(response.status).toBe(401);
  });

  it('casing differences in the internal field name are irrelevant — only the configured qid matters', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: VITAL_STATISTICS_FORM_ID,
        submissionID: 'sub-casing',
        rawRequest: JSON.stringify({ [`${VITAL_AUTH_QID}_SolisWebhookAuth`]: TEST_SECRET }),
      }),
    );
    expect(response.status).toBe(200);
  });

  it('an auto-generated placeholder internal name (e.g. input45) is irrelevant — only the configured qid matters', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: VITAL_STATISTICS_FORM_ID,
        submissionID: 'sub-autogen-name',
        rawRequest: JSON.stringify({ [`${VITAL_AUTH_QID}_input45`]: TEST_SECRET }),
      }),
    );
    expect(response.status).toBe(200);
  });

  it('never includes the configured secret or the received auth value in an error response body', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: ARRANGEMENT_FORMS_FORM_ID, submissionID: 'x', rawRequest: withAuth(ARRANGEMENT_AUTH_QID, {}, 'wrong-value') }),
    );
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain(TEST_SECRET);
    expect(JSON.stringify(body)).not.toContain('wrong-value');
  });

  it('an unrelated qid present elsewhere in the payload never influences which qid is trusted as the auth field', async () => {
    // A decoy entry at Arrangement's auth qid with the WRONG secret must
    // have zero effect on Vital Statistics' own resolution, which only
    // ever consults its own trusted config's webhookAuthFieldQid (45).
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: VITAL_STATISTICS_FORM_ID,
        submissionID: 'sub-decoy-qid',
        rawRequest: withAuth(VITAL_AUTH_QID, { [`${ARRANGEMENT_AUTH_QID}_soliswebhookauth`]: 'wrong-value' }),
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe('POST /api/webhooks/jotform — body size limits', () => {
  it('rejects an oversized payload via a Content-Length precheck before any parsing', async () => {
    const { POST } = await import('./route');
    const oversizedRequest = webhookRequest(
      { formID: VITAL_STATISTICS_FORM_ID, submissionID: 'sub-oversized', rawRequest: withAuth(VITAL_AUTH_QID) },
      { 'Content-Length': String(10 * 1024 * 1024) },
    );
    const response = await POST(oversizedRequest);
    expect(response.status).toBe(413);
  });

  it('rejects an oversized payload via the aggregate-size fallback when Content-Length is absent/understated', async () => {
    const { POST } = await import('./route');
    const hugeValue = 'x'.repeat(3 * 1024 * 1024);
    const response = await POST(
      webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: 'sub-huge', rawRequest: withAuth(VITAL_AUTH_QID, { bloat: hugeValue }) }),
    );
    expect(response.status).toBe(413);
  });
});

describe('POST /api/webhooks/jotform — malformed / unknown / disabled', () => {
  it('rejects a malformed payload missing formID/submissionID, regardless of auth value (parsing happens before config/auth resolution)', async () => {
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ somethingElse: 'x', rawRequest: withAuth(VITAL_AUTH_QID) }));
    expect(response.status).toBe(400);
  });

  it('a malformed body is rejected 400 even with a WRONG auth value — an unauthenticated caller cannot use response shape to probe validity', async () => {
    const { POST } = await import('./route');
    const response = await POST(webhookRequest({ somethingElse: 'x', rawRequest: withAuth(VITAL_AUTH_QID, {}, 'wrong-value') }));
    expect(response.status).toBe(400);
  });

  it('rejects (404) an unknown/unallowlisted form id — no auth-field guessing, no submission row created', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: 'unknown-form-id-999', submissionID: 'sub-1', rawRequest: withAuth(VITAL_AUTH_QID) }),
    );
    expect(response.status).toBe(404);
    expect(externalFormSubmissionFixtures.length).toBe(submissionLengthBefore);
  });

  it('rejects (404) a disabled form config exactly like an unknown one — no auth-field guessing, no submission row created', async () => {
    externalFormConfigFixtures.push({
      id: 'extform-config-disabled-test',
      organizationId: 'managed-cremations',
      provider: 'jotform',
      externalFormId: 'disabled-form-id-123',
      label: 'Disabled Test Form',
      audience: 'staff',
      fieldMap: '{}',
      linkTokenFieldName: 'solisLinkToken',
      linkTokenFieldQid: '1',
      webhookAuthFieldQid: '2',
      isEnabled: false,
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
    });
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: 'disabled-form-id-123', submissionID: 'sub-disabled', rawRequest: withAuth('2') }),
    );
    expect(response.status).toBe(404);
    expect(externalFormSubmissionFixtures.length).toBe(submissionLengthBefore);
  });
});

describe('POST /api/webhooks/jotform — matched submission', () => {
  it('resolves the case via the opaque token (extracted by its trusted qid), stores the submission as matched, and marks the CaseFormLink received', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { rawToken } = await generateLinkForSending('managed-cremations', 'case-webhook-1', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');

    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: ARRANGEMENT_FORMS_FORM_ID,
        submissionID: 'sub-matched-1',
        rawRequest: withAuth(ARRANGEMENT_AUTH_QID, { q1_caseNo: 'B2026-034', ...linkTokenEntry(ARRANGEMENT_LINK_QID, rawToken) }),
      }),
    );

    expect(response.status).toBe(200);
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'sub-matched-1');
    expect(submission?.status).toBe('matched');
    const link = caseFormLinkFixtures.find((l) => l.caseId === 'case-webhook-1');
    expect(link?.status).toBe('received');
    expect(link?.submissionId).toBe(submission?.id);
  });

  it('a link token present at the WRONG qid never links — the submission lands unmatched', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { rawToken } = await generateLinkForSending('managed-cremations', 'case-webhook-wrong-link-qid', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');

    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: ARRANGEMENT_FORMS_FORM_ID,
        submissionID: 'sub-wrong-link-qid',
        // Token posted under Vital Statistics' link-token qid (44), not
        // Arrangement Forms' own (274) — must never resolve.
        rawRequest: withAuth(ARRANGEMENT_AUTH_QID, linkTokenEntry(VITAL_LINK_QID, rawToken)),
      }),
    );
    expect(response.status).toBe(200);
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'sub-wrong-link-qid');
    expect(submission?.status).toBe('unmatched');
  });

  it('the link token\'s internal field name is irrelevant — only its qid is consulted', async () => {
    const { generateLinkForSending } = await import('@/services/caseFormLinkService');
    const { ARRANGEMENT_FORMS_FORM_CONFIG_ID } = await import('@/services/__mocks__/externalFormFixtures');
    const { rawToken } = await generateLinkForSending('managed-cremations', 'case-webhook-name-irrelevant', 'jotform', ARRANGEMENT_FORMS_FORM_CONFIG_ID, 'mock');

    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({
        formID: ARRANGEMENT_FORMS_FORM_ID,
        submissionID: 'sub-name-irrelevant',
        rawRequest: withAuth(ARRANGEMENT_AUTH_QID, { [`${ARRANGEMENT_LINK_QID}_input274`]: rawToken }),
      }),
    );
    expect(response.status).toBe(200);
    const submission = externalFormSubmissionFixtures.find((s) => s.externalSubmissionId === 'sub-name-irrelevant');
    expect(submission?.status).toBe('matched');
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
        rawRequest: withAuth(ARRANGEMENT_AUTH_QID, linkTokenEntry(ARRANGEMENT_LINK_QID, rawToken)),
      }),
    );

    expect(caseFixtures.length).toBe(casesBefore);
  });
});

describe('POST /api/webhooks/jotform — unmatched submission', () => {
  it('stores the submission as unmatched when no token is present', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      webhookRequest({ formID: VITAL_STATISTICS_FORM_ID, submissionID: 'sub-no-token', rawRequest: withAuth(VITAL_AUTH_QID) }),
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
        rawRequest: withAuth(VITAL_AUTH_QID, linkTokenEntry(VITAL_LINK_QID, 'never-issued-token-xyz')),
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
  it("regenerating a CaseFormLink's link token does not require or affect the webhook auth value", async () => {
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
        rawRequest: withAuth(ARRANGEMENT_AUTH_QID, linkTokenEntry(ARRANGEMENT_LINK_QID, first.rawToken)),
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
        rawRequest: withAuth(ARRANGEMENT_AUTH_QID, linkTokenEntry(ARRANGEMENT_LINK_QID, rawToken), null),
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
        rawRequest: withAuth(ARRANGEMENT_AUTH_QID, { ...linkTokenEntry(ARRANGEMENT_LINK_QID, rawToken), q1_caseNo: 'B2026-034' }),
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
    const rawRequest = withAuth(ARRANGEMENT_AUTH_QID, linkTokenEntry(ARRANGEMENT_LINK_QID, rawToken));

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
