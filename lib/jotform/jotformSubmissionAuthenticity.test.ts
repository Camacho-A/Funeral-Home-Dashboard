import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateJotformSubmission } from './jotformSubmissionAuthenticity';
import { fetchSubmissionAnswers, JotformClientError } from './jotformClient';

/**
 * Server-side webhook authentication (2026-10). Unit coverage for the
 * control that replaced the hidden-field shared secret. The webhook route's
 * own suites exercise this end to end; this file pins the module's
 * decision table directly, including the directions it must FAIL in.
 */
vi.mock('./jotformClient', async () => {
  const actual = await vi.importActual<typeof import('./jotformClient')>('./jotformClient');
  return { ...actual, fetchSubmissionAnswers: vi.fn() };
});

const FORM_ID = '262605621454050';
const OTHER_FORM_ID = '261945978664175';
const SUBMISSION_ID = '6213370000000000001';

/** Jotform's own `created_at` serialization — `YYYY-MM-DD HH:MM:SS`, no
    timezone offset (verified against the live API). */
function jotformTimestamp(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace('T', ' ');
}

function givenApiReturns(params: { formId?: string; submittedAt?: string | null; answers?: Record<string, { answer: string }> }) {
  vi.mocked(fetchSubmissionAnswers).mockResolvedValue({
    formId: params.formId ?? FORM_ID,
    submittedAt: params.submittedAt === undefined ? jotformTimestamp() : params.submittedAt,
    answers: params.answers ?? {},
  });
}

beforeEach(() => {
  vi.mocked(fetchSubmissionAnswers).mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('authenticateJotformSubmission — provenance', () => {
  it('authenticates a submission Jotform confirms on the claimed form, returning its own answers', async () => {
    givenApiReturns({ answers: { '3': { answer: 'Authoritative' } } });

    const result = await authenticateJotformSubmission({
      claimedFormId: FORM_ID,
      claimedSubmissionId: SUBMISSION_ID,
    });

    expect(result.authentic).toBe(true);
    if (!result.authentic) return;
    expect(result.answers).toEqual({ '3': { answer: 'Authoritative' } });
  });

  it('looks the submission up by the id claimed, through the authenticated client', async () => {
    givenApiReturns({});
    await authenticateJotformSubmission({ claimedFormId: FORM_ID, claimedSubmissionId: SUBMISSION_ID });
    expect(fetchSubmissionAnswers).toHaveBeenCalledWith(SUBMISSION_ID);
  });

  it('rejects a submission Jotform refuses to return — the live API answers 401 for one this account does not own', async () => {
    vi.mocked(fetchSubmissionAnswers).mockRejectedValue(
      new JotformClientError('Jotform submission retrieval failed with status 401.', 'http_error'),
    );

    const result = await authenticateJotformSubmission({ claimedFormId: FORM_ID, claimedSubmissionId: SUBMISSION_ID });

    expect(result).toMatchObject({ authentic: false, reason: 'submission_not_retrievable', status: 401 });
  });

  it('rejects a real submission claimed as a different form than Jotform reports', async () => {
    givenApiReturns({ formId: OTHER_FORM_ID });

    const result = await authenticateJotformSubmission({ claimedFormId: FORM_ID, claimedSubmissionId: SUBMISSION_ID });

    expect(result).toMatchObject({ authentic: false, reason: 'form_id_mismatch', status: 401 });
  });

  it('rejects a malformed identifier without spending an API call', async () => {
    for (const claimedSubmissionId of ['', 'abc', '123', 'sub-matched-1', '../../etc/passwd', '12345678901234567890123456789012345']) {
      const result = await authenticateJotformSubmission({ claimedFormId: FORM_ID, claimedSubmissionId });
      expect(result).toMatchObject({ authentic: false, reason: 'malformed_identifiers' });
    }
    expect(fetchSubmissionAnswers).not.toHaveBeenCalled();
  });

  it('rejects a malformed FORM id without spending an API call', async () => {
    const result = await authenticateJotformSubmission({
      claimedFormId: 'not-a-form-id',
      claimedSubmissionId: SUBMISSION_ID,
    });
    expect(result).toMatchObject({ authentic: false, reason: 'malformed_identifiers' });
    expect(fetchSubmissionAnswers).not.toHaveBeenCalled();
  });
});

describe('authenticateJotformSubmission — availability vs. authenticity', () => {
  it('reports a transient 503 when Jotform cannot be reached, so a genuine delivery is retried rather than dropped', async () => {
    vi.mocked(fetchSubmissionAnswers).mockRejectedValue(
      new JotformClientError('Network error contacting Jotform.', 'network_error'),
    );

    const result = await authenticateJotformSubmission({ claimedFormId: FORM_ID, claimedSubmissionId: SUBMISSION_ID });

    expect(result).toMatchObject({ authentic: false, reason: 'provider_unavailable', status: 503 });
  });

  it('fails closed, never open, when the API key is not configured', async () => {
    vi.mocked(fetchSubmissionAnswers).mockRejectedValue(
      new JotformClientError('JOTFORM_API_KEY is not configured.', 'missing_api_key'),
    );

    const result = await authenticateJotformSubmission({ claimedFormId: FORM_ID, claimedSubmissionId: SUBMISSION_ID });

    expect(result.authentic).toBe(false);
    expect(result).toMatchObject({ status: 503 });
  });

  it('never throws, whatever the client does', async () => {
    vi.mocked(fetchSubmissionAnswers).mockRejectedValue(new Error('something entirely unexpected'));

    await expect(
      authenticateJotformSubmission({ claimedFormId: FORM_ID, claimedSubmissionId: SUBMISSION_ID }),
    ).resolves.toMatchObject({ authentic: false });
  });
});

describe('authenticateJotformSubmission — historical-replay bound', () => {
  it('accepts a submission created moments ago', async () => {
    givenApiReturns({ submittedAt: jotformTimestamp(-30 * 1000) });
    const result = await authenticateJotformSubmission({ claimedFormId: FORM_ID, claimedSubmissionId: SUBMISSION_ID });
    expect(result.authentic).toBe(true);
  });

  it('accepts a fresh submission displaced by any plausible account timezone, in both directions', async () => {
    // `created_at` has no offset and is rendered in the Jotform account's
    // timezone, so a legitimate submission can read up to ~14h away from
    // server time. That must never be mistaken for a replay.
    for (const hours of [-13, -8, -1, 1, 8, 13]) {
      givenApiReturns({ submittedAt: jotformTimestamp(hours * 60 * 60 * 1000) });
      const result = await authenticateJotformSubmission({ claimedFormId: FORM_ID, claimedSubmissionId: SUBMISSION_ID });
      expect(result.authentic, `timezone displacement of ${hours}h must still authenticate`).toBe(true);
    }
  });

  it('rejects a submission from days ago — bounding bulk replay of submission history', async () => {
    givenApiReturns({ submittedAt: jotformTimestamp(-5 * 24 * 60 * 60 * 1000) });
    const result = await authenticateJotformSubmission({ claimedFormId: FORM_ID, claimedSubmissionId: SUBMISSION_ID });
    expect(result).toMatchObject({ authentic: false, reason: 'submission_too_old', status: 401 });
  });

  it('rejects a submission dated implausibly far in the future', async () => {
    givenApiReturns({ submittedAt: jotformTimestamp(5 * 24 * 60 * 60 * 1000) });
    const result = await authenticateJotformSubmission({ claimedFormId: FORM_ID, claimedSubmissionId: SUBMISSION_ID });
    expect(result).toMatchObject({ authentic: false, reason: 'submission_too_old' });
  });

  it('rejects a submission whose timestamp is absent or unparseable rather than assuming it is fresh', async () => {
    for (const submittedAt of [null, '', 'not a date', '2026-13-45 99:99:99x']) {
      givenApiReturns({ submittedAt });
      const result = await authenticateJotformSubmission({ claimedFormId: FORM_ID, claimedSubmissionId: SUBMISSION_ID });
      expect(result.authentic, `timestamp ${JSON.stringify(submittedAt)} must not authenticate`).toBe(false);
    }
  });

  it('evaluates the bound against the supplied clock, not only the real one', async () => {
    const submittedAt = '2026-10-01 12:00:00';
    givenApiReturns({ submittedAt });

    const withinBound = await authenticateJotformSubmission({
      claimedFormId: FORM_ID,
      claimedSubmissionId: SUBMISSION_ID,
      now: Date.parse('2026-10-01T13:00:00Z'),
    });
    expect(withinBound.authentic).toBe(true);

    givenApiReturns({ submittedAt });
    const pastBound = await authenticateJotformSubmission({
      claimedFormId: FORM_ID,
      claimedSubmissionId: SUBMISSION_ID,
      now: Date.parse('2026-10-08T13:00:00Z'),
    });
    expect(pastBound.authentic).toBe(false);
  });
});
