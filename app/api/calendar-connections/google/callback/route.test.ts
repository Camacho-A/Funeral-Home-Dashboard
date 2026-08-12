import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { calendarConnectionFixtures } from '@/services/__mocks__/calendarFixtures';

const cookieStore = new Map<string, { value: string }>();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string) => {
      cookieStore.set(name, { value });
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  })),
}));

const { GET } = await import('./route');
const { signOAuthStateCookie, OAUTH_STATE_COOKIE_NAME } = await import('@/lib/auth/calendarOAuthState');

function callbackRequest(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return GET(new Request(`http://localhost/api/calendar-connections/google/callback?${params.toString()}`));
}

beforeEach(() => {
  cookieStore.clear();
  calendarConnectionFixtures.length = 0;
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://beacon.test/api/calendar-connections/google/callback';
});
afterEach(() => {
  calendarConnectionFixtures.length = 0;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
  vi.unstubAllGlobals();
});

describe('GET /api/calendar-connections/google/callback', () => {
  it("redirects to Settings with calendarError when the provider itself reports an error", async () => {
    const response = await callbackRequest({ error: 'access_denied' });
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/settings/calendar-integrations');
    expect(location.searchParams.get('calendarError')).toBe('access_denied');
  });

  it('redirects with calendarError when code or state is missing', async () => {
    const response = await callbackRequest({});
    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('calendarError')).toBe('missing_code_or_state');
  });

  it('redirects with calendarError on a state mismatch (no cookie set)', async () => {
    const response = await callbackRequest({ code: 'auth-code', state: 'unmatched-state' });
    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('calendarError')).toBeTruthy();
  });

  it('completes the exchange and redirects with calendarConnected on success, clearing the state cookie', async () => {
    const stateCookieValue = signOAuthStateCookie({
      state: 'state-value',
      codeVerifier: 'verifier-value',
      organizationId: DEFAULT_ORGANIZATION_ID,
      staffProfileId: 'staff-dana',
      provider: 'google',
    });
    cookieStore.set(OAUTH_STATE_COOKIE_NAME, { value: stateCookieValue });

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'dana@gmail.com' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: 'primary', summary: 'dana@gmail.com' }] }) }),
    );

    const response = await callbackRequest({ code: 'auth-code', state: 'state-value' });
    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('calendarConnected')).toBe('google');
    expect(cookieStore.has(OAUTH_STATE_COOKIE_NAME)).toBe(false);
    expect(calendarConnectionFixtures.some((c) => c.staffProfileId === 'staff-dana' && c.status === 'connected')).toBe(true);
  });
});
