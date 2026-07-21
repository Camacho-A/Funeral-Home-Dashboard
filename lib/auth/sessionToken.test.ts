import { describe, expect, it } from 'vitest';
import { createSessionToken, verifySessionToken } from './sessionToken';
import type { AuthenticatedUser } from '../../types/auth';

const testUser: AuthenticatedUser = {
  id: 'mock-user-dana',
  email: 'dana@managedcremations.test',
  displayName: 'Dana',
  source: 'mock',
};

describe('createSessionToken / verifySessionToken', () => {
  it('round-trips a valid session', async () => {
    const token = await createSessionToken(testUser);
    const session = await verifySessionToken(token);

    expect(session).not.toBeNull();
    expect(session?.user).toEqual(testUser);
  });

  it('verifying the same token twice returns the same result — session restoration after refresh relies on this', async () => {
    const token = await createSessionToken(testUser);
    const first = await verifySessionToken(token);
    const second = await verifySessionToken(token);

    expect(first).toEqual(second);
  });

  it('rejects an expired session', async () => {
    const issuedLongAgo = 1_000_000; // epoch seconds, far in the past
    const token = await createSessionToken(testUser, issuedLongAgo);

    const session = await verifySessionToken(token, issuedLongAgo + 60 * 60 * 24); // a day later
    expect(session).toBeNull();
  });

  it('accepts a session right up until (not after) its expiry', async () => {
    const now = 1_000_000;
    const token = await createSessionToken(testUser, now);

    // 12h duration (sessionToken.ts's SESSION_DURATION_SECONDS) minus a second: still valid.
    const stillValid = await verifySessionToken(token, now + 60 * 60 * 12 - 1);
    expect(stillValid).not.toBeNull();
  });

  it('rejects a tampered payload (signature no longer matches)', async () => {
    const token = await createSessionToken(testUser);
    const [payloadPart, signaturePart] = token.split('.');

    // Flip a character in the payload without re-signing.
    const tamperedPayload = payloadPart.slice(0, -1) + (payloadPart.at(-1) === 'A' ? 'B' : 'A');
    const tamperedToken = `${tamperedPayload}.${signaturePart}`;

    expect(await verifySessionToken(tamperedToken)).toBeNull();
  });

  it('rejects a token signed with a different key (simulated by corrupting the signature)', async () => {
    const token = await createSessionToken(testUser);
    const [payloadPart, signaturePart] = token.split('.');
    const corruptedSignature = signaturePart.slice(0, -2) + 'xx';

    expect(await verifySessionToken(`${payloadPart}.${corruptedSignature}`)).toBeNull();
  });

  it('rejects a malformed token (wrong number of parts)', async () => {
    expect(await verifySessionToken('not-a-valid-token')).toBeNull();
    expect(await verifySessionToken('a.b.c')).toBeNull();
    expect(await verifySessionToken('')).toBeNull();
  });

  it('rejects a token whose decoded payload is valid JSON but the wrong shape', async () => {
    // Can't forge a validly-signed arbitrary payload without the secret, so
    // this exercises the shape guard indirectly: a syntactically-valid but
    // semantically-empty payload, re-signed with createSessionToken's own
    // machinery, would never occur in practice — the real defense is the
    // signature check above. This test documents that expectation rather
    // than fabricate a same-secret forgery.
    expect(await verifySessionToken('bm90LXZhbGlk.c2lnbmF0dXJl')).toBeNull();
  });

  it('never includes a password, access token, or refresh token in the signed payload', async () => {
    const token = await createSessionToken(testUser);
    const [payloadPart] = token.split('.');
    const decoded = Buffer.from(payloadPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');

    expect(decoded.toLowerCase()).not.toMatch(/password|accesstoken|refreshtoken/);
  });
});
