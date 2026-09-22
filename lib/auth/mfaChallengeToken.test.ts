import { describe, it, expect } from 'vitest';
import { createMfaChallengeToken, verifyMfaChallengeToken } from './mfaChallengeToken';
import { createFamilySessionToken, verifyFamilySessionToken } from './familySessionToken';

const PARAMS = { identityId: 'id-1', passwordVersionAtIssue: 3 };

describe('mfaChallengeToken', () => {
  it('round-trips a valid challenge token', async () => {
    const token = await createMfaChallengeToken(PARAMS);
    const payload = await verifyMfaChallengeToken(token);
    expect(payload).not.toBeNull();
    expect(payload).toMatchObject({ identityId: 'id-1', aud: 'mfa_challenge', passwordVersionAtIssue: 3 });
  });

  it('rejects a tampered payload', async () => {
    const token = await createMfaChallengeToken(PARAMS);
    const [, sig] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...PARAMS, aud: 'mfa_challenge', issuedAt: 0, expiresAt: 9999999999 })).toString('base64url');
    expect(await verifyMfaChallengeToken(`${forgedPayload}.${sig}`)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const now = 1_000_000;
    const token = await createMfaChallengeToken(PARAMS, now);
    expect(await verifyMfaChallengeToken(token, now + 5 * 60 + 1)).toBeNull(); // past the 5-min window
    expect(await verifyMfaChallengeToken(token, now + 60)).not.toBeNull();
  });

  it('rejects malformed input', async () => {
    expect(await verifyMfaChallengeToken('')).toBeNull();
    expect(await verifyMfaChallengeToken('a.b.c')).toBeNull();
    expect(await verifyMfaChallengeToken('notatoken')).toBeNull();
  });

  it('AUTH BOUNDARY: an MFA challenge token is NOT accepted as a family session, and a family session is not accepted as a challenge', async () => {
    const challenge = await createMfaChallengeToken(PARAMS);
    const family = await createFamilySessionToken({ portalUserId: 'pu-1', sessionId: 's-1' });
    // cross-verifier isolation both directions
    expect(await verifyFamilySessionToken(challenge)).toBeNull();
    expect(await verifyMfaChallengeToken(family)).toBeNull();
  });
});
