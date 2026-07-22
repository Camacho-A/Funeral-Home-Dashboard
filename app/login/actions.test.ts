import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_LOGIN_EMAIL, MOCK_LOGIN_PASSWORD, mockDefaultUser } from '@/services/__mocks__/authFixtures';

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
