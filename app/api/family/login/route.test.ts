import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalUserFixtures, portalSessionFixtures, portalAccessFixtures } from '@/services/__mocks__/portalFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { resetRateLimiter } from '@/lib/rateLimiter';
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

const { POST } = await import('./route');
const { FAMILY_SESSION_COOKIE_NAME } = await import('@/lib/auth/familySessionToken');

function loginRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/family/login', { method: 'POST', headers, body: JSON.stringify(body) }));
}

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-login-route-test-${idCounter}`;
}

let lengths: { users: number; sessions: number; access: number; events: number };
beforeEach(() => {
  idCounter = 0;
  cookieStore.clear();
  resetRateLimiter();
  lengths = { users: portalUserFixtures.length, sessions: portalSessionFixtures.length, access: portalAccessFixtures.length, events: activityEventFixtures.length };
});
afterEach(() => {
  portalUserFixtures.length = lengths.users;
  portalSessionFixtures.length = lengths.sessions;
  portalAccessFixtures.length = lengths.access;
  activityEventFixtures.length = lengths.events;
});

async function seedActivePortalUser() {
  const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
  const { portalUser } = await findOrCreatePortalUser(
    { email: 'family-login@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
    'mock',
  );
  return portalUser;
}

describe('POST /api/family/login', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await loginRequest({ email: 'x@example.com', password: 'x' }, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('rejects a missing email/password', async () => {
    expect((await loginRequest({ password: 'x' })).status).toBe(400);
    expect((await loginRequest({ email: 'x@example.com' })).status).toBe(400);
  });

  it('rejects an unknown email with a generic message, never revealing the email does not exist', async () => {
    const response = await loginRequest({ email: 'no-such-family@example.com', password: 'Password123!' });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Invalid email or password.');
  });

  it('rejects a wrong password with the identical generic message', async () => {
    await seedActivePortalUser();
    const response = await loginRequest({ email: 'family-login@example.com', password: 'WrongPassword!' });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Invalid email or password.');
  });

  it('rejects a disabled portal user identically to a wrong password', async () => {
    const { updatePortalUser } = await import('@/services/portal/portalUserService');
    const portalUser = await seedActivePortalUser();
    await updatePortalUser(portalUser.id, { status: 'disabled' }, 'mock');

    const response = await loginRequest({ email: 'family-login@example.com', password: 'Password123!' });
    expect(response.status).toBe(401);
  });

  it('logs in successfully, sets the family session cookie, and records portal.login for an active grant', async () => {
    const portalUser = await seedActivePortalUser();
    portalAccessFixtures.push({
      id: 'access-1',
      portalUserId: portalUser.id,
      organizationId: 'org-family-login-test',
      caseId: 'case-1',
      relationshipType: 'primary_next_of_kin',
      status: 'active',
      grantedFromInvitationId: 'invitation-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    const response = await loginRequest({ email: 'family-login@example.com', password: 'Password123!' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.portalUser.id).toBe(portalUser.id);
    expect(cookieStore.has(FAMILY_SESSION_COOKIE_NAME)).toBe(true);
    expect(activityEventFixtures.some((e) => e.eventType === 'portal.login')).toBe(true);
  });

  it('rate-limits repeated attempts for the same (ip, email)', async () => {
    await seedActivePortalUser();
    for (let i = 0; i < 10; i += 1) {
      await loginRequest({ email: 'family-login@example.com', password: 'WrongPassword!' });
    }
    const response = await loginRequest({ email: 'family-login@example.com', password: 'WrongPassword!' });
    expect(response.status).toBe(429);
  });
});
