import { describe, it, expect } from 'vitest';
import { createHistoricalCaseNumberAuthorization, verifyHistoricalCaseNumberAuthorization } from './historicalCaseNumberAuthorization';
import { createMfaChallengeToken, verifyMfaChallengeToken } from './mfaChallengeToken';

const PARAMS = { organizationId: 'org-1', externalFormId: '261945978664175', externalSubmissionId: 'sub-synthetic-1', caseNumber: 'B2026-035' };

describe('historicalCaseNumberAuthorization', () => {
  it('O: round-trips a valid authorization', async () => {
    const token = await createHistoricalCaseNumberAuthorization(PARAMS);
    const payload = await verifyHistoricalCaseNumberAuthorization(token);
    expect(payload).not.toBeNull();
    expect(payload).toMatchObject({ ...PARAMS, aud: 'historical_case_number' });
  });

  it('P: rejects an expired authorization', async () => {
    const now = 1_000_000;
    const token = await createHistoricalCaseNumberAuthorization(PARAMS, now);
    expect(await verifyHistoricalCaseNumberAuthorization(token, now + 5 * 60 + 1)).toBeNull();
    expect(await verifyHistoricalCaseNumberAuthorization(token, now + 60)).not.toBeNull();
  });

  it('Q: rejects a tampered payload (case number swapped post-issuance)', async () => {
    const token = await createHistoricalCaseNumberAuthorization(PARAMS);
    const [, sig] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...PARAMS, caseNumber: 'B2026-999', aud: 'historical_case_number', issuedAt: 0, expiresAt: 9999999999 }),
    ).toString('base64url');
    expect(await verifyHistoricalCaseNumberAuthorization(`${forgedPayload}.${sig}`)).toBeNull();
  });

  it('R: a token minted for one submission does not verify as valid for a different one (caller-side match fails)', async () => {
    const token = await createHistoricalCaseNumberAuthorization(PARAMS);
    const payload = await verifyHistoricalCaseNumberAuthorization(token);
    expect(payload?.externalSubmissionId).toBe('sub-synthetic-1');
    expect(payload?.externalSubmissionId).not.toBe('sub-synthetic-DIFFERENT');
  });

  it('S: a token minted for one organization does not verify as valid for a different one (caller-side match fails)', async () => {
    const token = await createHistoricalCaseNumberAuthorization(PARAMS);
    const payload = await verifyHistoricalCaseNumberAuthorization(token);
    expect(payload?.organizationId).toBe('org-1');
    expect(payload?.organizationId).not.toBe('org-DIFFERENT');
  });

  it('T: a token minted for one case number does not verify as valid for a different one (caller-side match fails)', async () => {
    const token = await createHistoricalCaseNumberAuthorization(PARAMS);
    const payload = await verifyHistoricalCaseNumberAuthorization(token);
    expect(payload?.caseNumber).toBe('B2026-035');
    expect(payload?.caseNumber).not.toBe('B2026-999');
  });

  it('rejects malformed input', async () => {
    expect(await verifyHistoricalCaseNumberAuthorization('')).toBeNull();
    expect(await verifyHistoricalCaseNumberAuthorization('a.b.c')).toBeNull();
    expect(await verifyHistoricalCaseNumberAuthorization('notatoken')).toBeNull();
  });

  it('AUTH BOUNDARY: a historical-case-number authorization is not accepted as an MFA challenge, and vice versa', async () => {
    const historical = await createHistoricalCaseNumberAuthorization(PARAMS);
    const mfa = await createMfaChallengeToken({ identityId: 'id-1', passwordVersionAtIssue: 1 });
    expect(await verifyMfaChallengeToken(historical)).toBeNull();
    expect(await verifyHistoricalCaseNumberAuthorization(mfa)).toBeNull();
  });
});
