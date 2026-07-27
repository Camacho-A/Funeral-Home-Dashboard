import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_LOGIN_EMAIL, MOCK_LOGIN_PASSWORD, mockDefaultUser } from '@/services/__mocks__/authFixtures';
import {
  identityFixtures,
  identitySessionFixtures,
  loginActivityEventFixtures,
  MANORS_ADMIN_IDENTITY_ID,
  MANORS_ADMIN_DEMO_PASSWORD,
  type MockIdentityRecord,
} from '@/services/__mocks__/identityFixtures';
import { MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT } from '@/domain/identity/lockoutPolicy';

const ENV_KEYS = ['DATA_ADAPTER', 'AUTH_ADAPTER', 'WIX_OAUTH_CLIENT_ID'] as const;
let originalEnv: Record<string, string | undefined>;

const redirectCalls: string[] = [];
const createSession = vi.fn();
const loginWithWix = vi.fn();

// redirect() throws in real Next.js to abort rendering — mocked here to
// record the URL instead, matching the established pattern (see
// lib/auth/session.test.ts's next/headers mock) of substituting only the
// framework API a plain Vitest test has no context for, while letting
// loginAction's own real logic run.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectCalls.push(url);
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => (name === 'user-agent' ? 'vitest-agent' : null),
  })),
}));

vi.mock('@/lib/auth/session', () => ({
  createSession,
  clearSession: vi.fn(),
}));

vi.mock('@/lib/auth/wixAuth', () => ({
  loginWithWix,
}));

const { loginAction } = await import('./actions');

function formData(email: string, password: string) {
  const data = new FormData();
  data.set('email', email);
  data.set('password', password);
  data.set('next', '/dashboard');
  return data;
}

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  redirectCalls.length = 0;
  createSession.mockClear();
  loginWithWix.mockClear();
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

describe('loginAction — branches on AUTH_ADAPTER, not DATA_ADAPTER', () => {
  it('uses mock login when AUTH_ADAPTER=mock, even with DATA_ADAPTER=wix (real Wix data, mock auth)', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.AUTH_ADAPTER = 'mock';

    await expect(loginAction(formData(MOCK_LOGIN_EMAIL, MOCK_LOGIN_PASSWORD))).rejects.toThrow('REDIRECT:');

    expect(loginWithWix).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledWith(mockDefaultUser);
    expect(redirectCalls[0]).toBe('/dashboard');
  });

  it('uses Wix login when AUTH_ADAPTER=wix, even with DATA_ADAPTER=mock (mock data, real auth)', async () => {
    process.env.DATA_ADAPTER = 'mock';
    process.env.AUTH_ADAPTER = 'wix';
    loginWithWix.mockResolvedValue({ success: false, reason: 'invalid_credentials' });

    await expect(loginAction(formData('someone@example.com', 'whatever'))).rejects.toThrow('REDIRECT:');

    expect(loginWithWix).toHaveBeenCalledWith('someone@example.com', 'whatever');
    expect(createSession).not.toHaveBeenCalled();
    expect(redirectCalls[0]).toMatch(/error=invalid_credentials/);
  });

  it('defaults to mock login when AUTH_ADAPTER is unset', async () => {
    // DATA_ADAPTER also left unset — this is the actual environment
    // npm run dev/test/build run under by default.
    await expect(loginAction(formData(MOCK_LOGIN_EMAIL, MOCK_LOGIN_PASSWORD))).rejects.toThrow('REDIRECT:');

    expect(loginWithWix).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledWith(mockDefaultUser);
  });

  it('rejects wrong mock credentials without ever calling loginWithWix', async () => {
    process.env.AUTH_ADAPTER = 'mock';

    await expect(loginAction(formData(MOCK_LOGIN_EMAIL, 'wrong-password'))).rejects.toThrow('REDIRECT:');

    expect(loginWithWix).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(redirectCalls[0]).toMatch(/error=invalid_credentials/);
  });
});

describe('loginAction — AUTH_ADAPTER=identity', () => {
  let lengths: { identity: number; sessions: number; events: number };
  let adminSnapshot: MockIdentityRecord;

  beforeEach(() => {
    process.env.AUTH_ADAPTER = 'identity';
    lengths = {
      identity: identityFixtures.length,
      sessions: identitySessionFixtures.length,
      events: loginActivityEventFixtures.length,
    };
    adminSnapshot = { ...identityFixtures.find((i) => i.id === MANORS_ADMIN_IDENTITY_ID)! };
  });

  afterEach(() => {
    identityFixtures.length = lengths.identity;
    identitySessionFixtures.length = lengths.sessions;
    loginActivityEventFixtures.length = lengths.events;
    const adminIndex = identityFixtures.findIndex((i) => i.id === MANORS_ADMIN_IDENTITY_ID);
    if (adminIndex !== -1) identityFixtures[adminIndex] = adminSnapshot;
  });

  it('logs in with correct credentials, creating both the signed cookie and a registry session row', async () => {
    await expect(loginAction(formData(mockDefaultUser.email, MANORS_ADMIN_DEMO_PASSWORD))).rejects.toThrow('REDIRECT:');

    expect(createSession).toHaveBeenCalledTimes(1);
    const [user, sessionId] = createSession.mock.calls[0];
    expect(user).toMatchObject({ id: MANORS_ADMIN_IDENTITY_ID, email: mockDefaultUser.email, source: 'identity' });
    expect(typeof sessionId).toBe('string');
    expect(identitySessionFixtures.some((s) => s.id === sessionId && s.identityId === MANORS_ADMIN_IDENTITY_ID)).toBe(true);
    expect(redirectCalls[0]).toBe('/dashboard');
  });

  it('rotates the session on every login — two successive logins from the same account get two distinct, independently-valid session ids', async () => {
    await expect(loginAction(formData(mockDefaultUser.email, MANORS_ADMIN_DEMO_PASSWORD))).rejects.toThrow('REDIRECT:');
    const [, firstSessionId] = createSession.mock.calls[0];

    createSession.mockClear();
    await expect(loginAction(formData(mockDefaultUser.email, MANORS_ADMIN_DEMO_PASSWORD))).rejects.toThrow('REDIRECT:');
    const [, secondSessionId] = createSession.mock.calls[0];

    expect(firstSessionId).not.toBe(secondSessionId);
    expect(identitySessionFixtures.filter((s) => s.identityId === MANORS_ADMIN_IDENTITY_ID && s.revokedAt === null)).toHaveLength(2);

    const { resolveIdentitySession } = await import('@/lib/auth/resolveIdentitySession');
    const asSession = (sessionId: string) => ({
      user: { id: MANORS_ADMIN_IDENTITY_ID, email: mockDefaultUser.email, displayName: mockDefaultUser.displayName, source: 'identity' as const },
      issuedAt: 0,
      expiresAt: Number.MAX_SAFE_INTEGER,
      sessionId,
    });
    expect((await resolveIdentitySession(asSession(firstSessionId), 'mock')).valid).toBe(true);
    expect((await resolveIdentitySession(asSession(secondSessionId), 'mock')).valid).toBe(true);
  });

  it('rejects an incorrect password without revealing which part was wrong, and records a failed login', async () => {
    await expect(loginAction(formData(mockDefaultUser.email, 'wrong-password'))).rejects.toThrow('REDIRECT:');

    expect(createSession).not.toHaveBeenCalled();
    expect(redirectCalls[0]).toMatch(/error=invalid_credentials/);
    expect(
      loginActivityEventFixtures.some((e) => e.identityId === MANORS_ADMIN_IDENTITY_ID && e.eventType === 'login_failed'),
    ).toBe(true);
  });

  it('rejects an unknown email the same way as a wrong password (no email-enumeration signal)', async () => {
    await expect(loginAction(formData('nobody@example.com', 'whatever'))).rejects.toThrow('REDIRECT:');

    expect(createSession).not.toHaveBeenCalled();
    expect(redirectCalls[0]).toMatch(/error=invalid_credentials/);
    expect(loginActivityEventFixtures.some((e) => e.identityId === null && e.eventType === 'login_failed')).toBe(true);
  });

  it('locks the account after repeated failures, then reports account_locked distinctly on the next attempt', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT; i += 1) {
      await expect(loginAction(formData(mockDefaultUser.email, 'wrong-password'))).rejects.toThrow('REDIRECT:');
    }

    redirectCalls.length = 0;
    await expect(loginAction(formData(mockDefaultUser.email, MANORS_ADMIN_DEMO_PASSWORD))).rejects.toThrow('REDIRECT:');
    expect(redirectCalls[0]).toMatch(/error=account_locked/);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('requires email verification for a not-yet-verified identity even with the correct password', async () => {
    const { findOrCreateIdentity } = await import('@/services/identityService');
    const { setPassword } = await import('@/services/passwordService');
    const { identity } = await findOrCreateIdentity(
      { email: 'pending.user@example.com', displayName: 'Pending', idFactory: () => 'test-pending-identity' },
      'mock',
    );
    await setPassword(identity.id, 'SomePassword1!', 'mock');

    await expect(loginAction(formData('pending.user@example.com', 'SomePassword1!'))).rejects.toThrow('REDIRECT:');
    expect(redirectCalls[0]).toMatch(/error=email_verification_required/);
    expect(createSession).not.toHaveBeenCalled();
  });
});
