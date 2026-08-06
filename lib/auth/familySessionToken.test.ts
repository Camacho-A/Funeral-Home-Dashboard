import { describe, expect, it } from 'vitest';
import { createFamilySessionToken, verifyFamilySessionToken, FAMILY_SESSION_COOKIE_NAME } from './familySessionToken';
import { SESSION_COOKIE_NAME, createSessionToken, verifySessionToken } from './sessionToken';

const params = { portalUserId: 'portal-user-1', sessionId: 'portal-session-1' };

describe('createFamilySessionToken / verifyFamilySessionToken', () => {
  it('round-trips a valid family session', async () => {
    const token = await createFamilySessionToken(params);
    const session = await verifyFamilySessionToken(token);

    expect(session).not.toBeNull();
    expect(session?.portalUserId).toBe(params.portalUserId);
    expect(session?.sessionId).toBe(params.sessionId);
    expect(session?.aud).toBe('family');
  });

  it('always carries a sessionId — unlike AuthSession, never optional', async () => {
    const token = await createFamilySessionToken(params);
    const session = await verifyFamilySessionToken(token);
    expect(typeof session?.sessionId).toBe('string');
  });

  it('rejects an expired session', async () => {
    const issuedLongAgo = 1_000_000;
    const token = await createFamilySessionToken(params, issuedLongAgo);
    const session = await verifyFamilySessionToken(token, issuedLongAgo + 60 * 60 * 24 * 31); // 31 days later
    expect(session).toBeNull();
  });

  it('accepts a session right up until (not after) its 30-day expiry', async () => {
    const now = 1_000_000;
    const token = await createFamilySessionToken(params, now);
    const stillValid = await verifyFamilySessionToken(token, now + 60 * 60 * 24 * 30 - 1);
    expect(stillValid).not.toBeNull();
  });

  it('rejects a tampered payload (signature no longer matches)', async () => {
    const token = await createFamilySessionToken(params);
    const [payloadPart, signaturePart] = token.split('.');
    const tamperedPayload = payloadPart.slice(0, -1) + (payloadPart.at(-1) === 'A' ? 'B' : 'A');
    expect(await verifyFamilySessionToken(`${tamperedPayload}.${signaturePart}`)).toBeNull();
  });

  it('rejects a malformed token (wrong number of parts)', async () => {
    expect(await verifyFamilySessionToken('not-a-valid-token')).toBeNull();
    expect(await verifyFamilySessionToken('a.b.c')).toBeNull();
    expect(await verifyFamilySessionToken('')).toBeNull();
  });

  it('uses a distinct cookie name from the staff session', () => {
    expect(FAMILY_SESSION_COOKIE_NAME).not.toBe(SESSION_COOKIE_NAME);
    expect(FAMILY_SESSION_COOKIE_NAME).toBe('beacon_family_session');
  });

  it('a staff session token is never accepted by the family verifier, even carrying a matching-shaped payload', async () => {
    const staffToken = await createSessionToken({ id: 'portal-user-1', email: 'x@example.com', displayName: 'X', source: 'mock' });
    expect(await verifyFamilySessionToken(staffToken)).toBeNull();
  });

  it('a family session token is never accepted by the staff verifier', async () => {
    const familyToken = await createFamilySessionToken(params);
    expect(await verifySessionToken(familyToken)).toBeNull();
  });

  it('never includes a password or provider token in the signed payload', async () => {
    const token = await createFamilySessionToken(params);
    const [payloadPart] = token.split('.');
    const decoded = Buffer.from(payloadPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    expect(decoded.toLowerCase()).not.toMatch(/password|accesstoken|refreshtoken/);
  });
});
