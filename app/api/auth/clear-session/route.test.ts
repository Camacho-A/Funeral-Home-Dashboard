import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE_NAME, createSessionToken } from '@/lib/auth/sessionToken';
import { createIdentitySession, revokeSession } from '@/services/sessionService';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { GUS_ADMIN_IDENTITY_ID, GUS_ADMIN_EMAIL } from '@/services/__mocks__/gusFixtures';
import { clearSessionPath, CLEAR_SESSION_REASONS } from '@/lib/auth/session';

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

const { GET } = await import('./route');

const ENV_KEYS = ['DATA_ADAPTER', 'AUTH_ADAPTER'] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.DATA_ADAPTER = 'mock';
  process.env.AUTH_ADAPTER = 'identity';
  jar.cookies.clear();
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

async function identityCookie(): Promise<{ sessionId: string }> {
  const registryRow = await createIdentitySession(
    { identityId: GUS_ADMIN_IDENTITY_ID, deviceId: 'device', passwordVersionAtIssue: 1, idFactory: () => crypto.randomUUID() },
    'mock',
  );
  const token = await createSessionToken(
    { id: GUS_ADMIN_IDENTITY_ID, email: GUS_ADMIN_EMAIL, displayName: 'Avery Demo', source: 'identity' },
    undefined,
    registryRow.id,
  );
  jar.cookies.set(SESSION_COOKIE_NAME, token);
  return { sessionId: registryRow.id };
}

function request(query: string): Request {
  return new Request(`http://localhost:3000/api/auth/clear-session${query}`);
}

function deletesSessionCookie(response: Response): boolean {
  const setCookie = response.headers.get('set-cookie') ?? '';
  return setCookie.includes(`${SESSION_COOKIE_NAME}=;`) && /max-age=0/i.test(setCookie);
}

describe('GET /api/auth/clear-session', () => {
  it('deletes a revoked session cookie and redirects to /login with the reason', async () => {
    const { sessionId } = await identityCookie();
    await revokeSession(sessionId, 'mock');

    const response = await GET(request('?reason=revoked'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost:3000/login?error=revoked');
    expect(deletesSessionCookie(response)).toBe(true);
  });

  it('deletes a cookie whose registry row does not exist', async () => {
    jar.cookies.set(
      SESSION_COOKIE_NAME,
      await createSessionToken({ id: GUS_ADMIN_IDENTITY_ID, email: GUS_ADMIN_EMAIL, displayName: 'x', source: 'identity' }, undefined, 'missing'),
    );

    const response = await GET(request('?reason=session_not_found'));

    expect(response.headers.get('location')).toBe('http://localhost:3000/login?error=session_not_found');
    expect(deletesSessionCookie(response)).toBe(true);
  });

  it('deletes an unverifiable (garbage) cookie', async () => {
    jar.cookies.set(SESSION_COOKIE_NAME, 'not-a-real-token');

    const response = await GET(request('?reason=expired'));

    expect(response.headers.get('location')).toBe('http://localhost:3000/login?error=expired');
    expect(deletesSessionCookie(response)).toBe(true);
  });

  it('deletes a mock-login session presented to a deployment on real Wix data', async () => {
    jar.cookies.set(SESSION_COOKIE_NAME, await createSessionToken(mockDefaultUser));
    process.env.DATA_ADAPTER = 'wix';

    const response = await GET(request('?reason=auth_adapter_not_allowed'));

    expect(response.headers.get('location')).toBe('http://localhost:3000/login?error=auth_adapter_not_allowed');
    expect(deletesSessionCookie(response)).toBe(true);
  });

  it('never deletes a still-valid session (a cross-site GET cannot sign anyone out)', async () => {
    await identityCookie();

    const response = await GET(request('?reason=revoked'));

    expect(response.headers.get('location')).toBe('http://localhost:3000/login?error=revoked');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each([
    ['an unknown reason', '?reason=whatever'],
    ['an absolute URL as reason', '?reason=https%3A%2F%2Fevil.example%2F'],
    ['a protocol-relative path as reason', '?reason=%2F%2Fevil.example'],
    ['a next= parameter', '?next=https%3A%2F%2Fevil.example%2F'],
    ['no reason at all', ''],
  ])('only ever redirects to the fixed internal /login path — %s', async (_label, query) => {
    const response = await GET(request(query));
    const location = new URL(response.headers.get('location')!);

    expect(location.origin).toBe('http://localhost:3000');
    expect(location.pathname).toBe('/login');
    expect(location.search).toBe('?error=session_not_found');
  });
});

describe('clearSessionPath', () => {
  it('builds the internal handler path for every allowlisted reason', () => {
    for (const reason of CLEAR_SESSION_REASONS) {
      expect(clearSessionPath(reason)).toBe(`/api/auth/clear-session?reason=${reason}`);
    }
  });

  it('collapses an unknown reason to the default rather than echoing it', () => {
    expect(clearSessionPath('<script>')).toBe('/api/auth/clear-session?reason=session_not_found');
  });
});
