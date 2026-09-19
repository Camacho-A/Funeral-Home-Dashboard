import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, identitySessionFixtures, loginActivityEventFixtures, MANORS_ADMIN_IDENTITY_ID, MANORS_ADMIN_DEMO_PASSWORD } from '@/services/__mocks__/identityFixtures';
import { generateTotpCode } from '@/lib/identity/totp';

const redirectCalls: string[] = [];
const createSession = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectCalls.push(url);
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({ get: (n: string) => (n === 'user-agent' ? 'vitest-agent' : null) })),
}));
vi.mock('@/lib/auth/session', () => ({ createSession, clearSession: vi.fn() }));

// Capturing MFA-challenge cookie so login → challenge can chain in one test.
let challengeCookie: string | null = null;
vi.mock('@/lib/auth/mfaChallengeCookie', () => ({
  setMfaChallengeCookie: vi.fn(async (t: string) => { challengeCookie = t; }),
  readMfaChallengeCookie: vi.fn(async () => challengeCookie),
  clearMfaChallengeCookie: vi.fn(async () => { challengeCookie = null; }),
}));

const { loginAction, submitMfaChallenge } = await import('./actions');
const { beginMfaEnrollment, verifyMfaEnrollment, disableMfa } = await import('@/services/mfaService');

let secret = '';

async function run(action: () => Promise<void>): Promise<void> {
  try { await action(); } catch (e) { if (!(e as Error).message?.startsWith('REDIRECT:')) throw e; }
}

beforeEach(async () => {
  process.env.AUTH_ADAPTER = 'identity';
  process.env.DATA_ADAPTER = 'mock';
  redirectCalls.length = 0;
  createSession.mockClear();
  challengeCookie = null;
  // Enroll MFA on the admin fixture.
  const enroll = await beginMfaEnrollment(MANORS_ADMIN_IDENTITY_ID, 'mock');
  secret = enroll.secret;
  await verifyMfaEnrollment(MANORS_ADMIN_IDENTITY_ID, generateTotpCode(secret), 'mock');
});

afterEach(async () => {
  await disableMfa(MANORS_ADMIN_IDENTITY_ID, 'mock');
  delete process.env.AUTH_ADAPTER;
  delete process.env.DATA_ADAPTER;
  identitySessionFixtures.length = 0;
  loginActivityEventFixtures.length = 0;
});

function loginForm() {
  const d = new FormData();
  d.set('email', identityFixtures.find((i) => i.id === MANORS_ADMIN_IDENTITY_ID)!.email);
  d.set('password', MANORS_ADMIN_DEMO_PASSWORD);
  d.set('next', '/dashboard');
  return d;
}
function challengeForm(code: string, useRecovery = false) {
  const d = new FormData();
  d.set('code', code);
  d.set('next', '/dashboard');
  if (useRecovery) d.set('useRecoveryCode', 'on');
  return d;
}

describe('MFA login challenge (Phase 40 auth boundary)', () => {
  it('AUTH BOUNDARY: a correct password on an MFA account does NOT create a session — it issues a challenge and redirects to /login/mfa', async () => {
    await run(() => loginAction(loginForm()));
    expect(createSession).not.toHaveBeenCalled(); // no session from password alone
    expect(challengeCookie).not.toBeNull(); // pending-challenge cookie was set
    expect(redirectCalls.at(-1)).toMatch(/^\/login\/mfa\?next=/);
  });

  it('a valid TOTP code completes the challenge and creates the real session', async () => {
    await run(() => loginAction(loginForm()));
    createSession.mockClear();
    await run(() => submitMfaChallenge(challengeForm(generateTotpCode(secret))));
    expect(createSession).toHaveBeenCalledOnce();
    expect(challengeCookie).toBeNull(); // challenge cookie cleared
    expect(redirectCalls.at(-1)).toBe('/dashboard');
  });

  it('a wrong code does NOT create a session and re-prompts', async () => {
    await run(() => loginAction(loginForm()));
    createSession.mockClear();
    await run(() => submitMfaChallenge(challengeForm('000000')));
    expect(createSession).not.toHaveBeenCalled();
    expect(redirectCalls.at(-1)).toMatch(/^\/login\/mfa\?error=invalid_code/);
  });

  it('a valid single-use recovery code completes the challenge', async () => {
    // Re-enroll to capture the recovery codes.
    await disableMfa(MANORS_ADMIN_IDENTITY_ID, 'mock');
    const enroll = await beginMfaEnrollment(MANORS_ADMIN_IDENTITY_ID, 'mock');
    const res = await verifyMfaEnrollment(MANORS_ADMIN_IDENTITY_ID, generateTotpCode(enroll.secret), 'mock');
    const recoveryCode = res.recoveryCodes![0];
    await run(() => loginAction(loginForm()));
    createSession.mockClear();
    await run(() => submitMfaChallenge(challengeForm(recoveryCode, true)));
    expect(createSession).toHaveBeenCalledOnce();
  });

  it('rate limiting: repeated wrong MFA codes lock the account (challenge failures feed the same persistent lockout as wrong passwords)', async () => {
    const { MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT } = await import('@/domain/identity/lockoutPolicy');
    await run(() => loginAction(loginForm()));
    let lastRedirect = '';
    for (let i = 0; i < MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT; i += 1) {
      redirectCalls.length = 0;
      await run(() => submitMfaChallenge(challengeForm('000000')));
      lastRedirect = redirectCalls.at(-1) ?? '';
    }
    expect(createSession).not.toHaveBeenCalled();
    // the final failed attempt trips the lockout and returns to /login locked
    expect(lastRedirect).toMatch(/^\/login\?error=account_locked/);
    const { getIdentityById } = await import('@/services/identityService');
    expect((await getIdentityById(MANORS_ADMIN_IDENTITY_ID, 'mock'))?.status).toBe('locked');
  });

  it('AUTH BOUNDARY: submitting a challenge with no pending-challenge cookie creates no session and returns to /login', async () => {
    challengeCookie = null;
    await run(() => submitMfaChallenge(challengeForm(generateTotpCode(secret))));
    expect(createSession).not.toHaveBeenCalled();
    expect(redirectCalls.at(-1)).toMatch(/^\/login\?error=mfa_challenge_expired/);
  });
});
