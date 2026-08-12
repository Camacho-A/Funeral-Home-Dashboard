import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePkcePair, generateOAuthState, signOAuthStateCookie, verifyOAuthStateCookie } from './calendarOAuthState';

afterEach(() => {
  vi.useRealTimers();
});

describe('generatePkcePair', () => {
  it('produces a distinct verifier/challenge pair each call, challenge derived from verifier', () => {
    const a = generatePkcePair();
    const b = generatePkcePair();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
    expect(a.codeChallenge.length).toBeGreaterThan(20);
  });
});

describe('generateOAuthState', () => {
  it('produces a distinct value each call', () => {
    expect(generateOAuthState()).not.toBe(generateOAuthState());
  });
});

describe('signOAuthStateCookie / verifyOAuthStateCookie', () => {
  const basePayload = { state: 'state-value', codeVerifier: 'verifier-value', organizationId: 'org-1', staffProfileId: 'staff-1', provider: 'google' as const };

  it('round-trips a valid cookie', () => {
    const cookie = signOAuthStateCookie(basePayload);
    const result = verifyOAuthStateCookie(cookie, 'state-value');
    expect(result).toMatchObject(basePayload);
  });

  it('rejects a state mismatch (the actual CSRF check)', () => {
    const cookie = signOAuthStateCookie(basePayload);
    expect(verifyOAuthStateCookie(cookie, 'a-different-state')).toBeNull();
  });

  it('rejects a tampered cookie (signature no longer matches)', () => {
    const cookie = signOAuthStateCookie(basePayload);
    const [encoded] = cookie.split('.');
    const tampered = `${encoded}.wrong-signature`;
    expect(verifyOAuthStateCookie(tampered, 'state-value')).toBeNull();
  });

  it('rejects a tampered payload (re-encoded with a different org, wrong signature)', () => {
    const cookie = signOAuthStateCookie(basePayload);
    const forgedEncoded = Buffer.from(JSON.stringify({ ...basePayload, organizationId: 'org-attacker', issuedAt: Date.now() }), 'utf8').toString('base64url');
    const [, originalSignature] = cookie.split('.');
    expect(verifyOAuthStateCookie(`${forgedEncoded}.${originalSignature}`, 'state-value')).toBeNull();
  });

  it('rejects a missing or malformed cookie', () => {
    expect(verifyOAuthStateCookie(undefined, 'state-value')).toBeNull();
    expect(verifyOAuthStateCookie('not-a-valid-cookie', 'state-value')).toBeNull();
    expect(verifyOAuthStateCookie('only-one-part', 'state-value')).toBeNull();
  });

  it('rejects an expired cookie (past the 10-minute TTL)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    const cookie = signOAuthStateCookie(basePayload);

    vi.setSystemTime(new Date('2026-09-01T00:11:00.000Z')); // 11 minutes later
    expect(verifyOAuthStateCookie(cookie, 'state-value')).toBeNull();
  });

  it('accepts a cookie still within the TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    const cookie = signOAuthStateCookie(basePayload);

    vi.setSystemTime(new Date('2026-09-01T00:09:00.000Z')); // 9 minutes later
    expect(verifyOAuthStateCookie(cookie, 'state-value')).not.toBeNull();
  });
});
