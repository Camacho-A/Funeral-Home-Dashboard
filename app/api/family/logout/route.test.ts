import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalUserFixtures, portalSessionFixtures } from '@/services/__mocks__/portalFixtures';
import { hashPassword } from '@/lib/identity/passwordHashing';

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

const { POST: logout } = await import('./route');
const { createFamilySession } = await import('@/lib/auth/familySession');
const { FAMILY_SESSION_COOKIE_NAME } = await import('@/lib/auth/familySessionToken');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-logout-route-test-${idCounter}`;
}

function logoutRequest(headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return logout(new Request('http://localhost/api/family/logout', { method: 'POST', headers }));
}

let lengths: { users: number; sessions: number };
beforeEach(() => {
  idCounter = 0;
  cookieStore.clear();
  lengths = { users: portalUserFixtures.length, sessions: portalSessionFixtures.length };
});
afterEach(() => {
  portalUserFixtures.length = lengths.users;
  portalSessionFixtures.length = lengths.sessions;
});

describe('POST /api/family/logout', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await logoutRequest({ origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('is a no-op success when there is no session', async () => {
    const response = await logoutRequest();
    expect(response.status).toBe(200);
  });

  it('revokes the server-side PortalSession row and clears the cookie', async () => {
    const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
    const { createPortalSession, getSessionById } = await import('@/services/portal/portalSessionService');
    const { portalUser } = await findOrCreatePortalUser(
      { email: 'family-logout@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );
    const session = await createPortalSession({ portalUserId: portalUser.id, deviceId: 'device-1', idFactory }, 'mock');
    await createFamilySession({ portalUserId: portalUser.id, sessionId: session.id });

    const response = await logoutRequest();
    expect(response.status).toBe(200);
    expect(cookieStore.has(FAMILY_SESSION_COOKIE_NAME)).toBe(false);

    const reloaded = await getSessionById(session.id, 'mock');
    expect(reloaded?.revokedAt).not.toBeNull();
  });
});
