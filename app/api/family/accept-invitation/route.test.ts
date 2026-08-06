import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalInvitationFixtures, portalAccessFixtures, portalUserFixtures, portalSessionFixtures } from '@/services/__mocks__/portalFixtures';
import { resetRateLimiter } from '@/lib/rateLimiter';

vi.mock('@/lib/identity/messageSender', () => ({ getIdentityMessageSender: () => ({ send: async () => undefined }) }));

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
const { issueInvitation } = await import('@/services/portal/portalInvitationService');
const { FAMILY_SESSION_COOKIE_NAME } = await import('@/lib/auth/familySessionToken');

const TEST_CASE_ID = 'case-accept-invitation-route-test';
const ORG_ID = 'org-accept-invitation-route-test';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `accept-invitation-route-test-${idCounter}`;
}

function acceptRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/family/accept-invitation', { method: 'POST', headers, body: JSON.stringify(body) }));
}

beforeEach(() => {
  idCounter = 0;
  cookieStore.clear();
  resetRateLimiter();
  portalInvitationFixtures.length = 0;
  portalAccessFixtures.length = 0;
  portalUserFixtures.length = 0;
  portalSessionFixtures.length = 0;
});
afterEach(() => {
  portalInvitationFixtures.length = 0;
  portalAccessFixtures.length = 0;
  portalUserFixtures.length = 0;
  portalSessionFixtures.length = 0;
});

async function seedInvitation() {
  const { rawToken } = await issueInvitation(
    { organizationId: ORG_ID, caseId: TEST_CASE_ID, email: 'family@example.com', displayName: 'Pat Family', relationshipType: 'primary_next_of_kin', idFactory },
    { organizationId: ORG_ID, actorIdentityId: 'staff-1', actorMembershipId: null, actorRoleKey: 'funeralDirector', correlationId: 'corr-1' },
    'mock',
  );
  return rawToken;
}

describe('POST /api/family/accept-invitation', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await acceptRequest({ token: 'x', password: 'Password123!' }, { origin: 'http://evil.test', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('rejects a missing token', async () => {
    const response = await acceptRequest({ password: 'Password123!' });
    expect(response.status).toBe(400);
  });

  it('rejects a too-short password', async () => {
    const response = await acceptRequest({ token: 'x', password: 'short' });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid token without distinguishing why', async () => {
    const response = await acceptRequest({ token: 'not-a-real-token', password: 'Password123!' });
    expect(response.status).toBe(400);
  });

  it('accepts a valid invitation, sets the family session cookie, and never returns the raw token', async () => {
    const rawToken = await seedInvitation();
    const response = await acceptRequest({ token: rawToken, password: 'Password123!' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.portalUser.displayName).toBe('Pat Family');
    expect(JSON.stringify(body)).not.toContain(rawToken);

    expect(cookieStore.has(FAMILY_SESSION_COOKIE_NAME)).toBe(true);
  });

  it('rate-limits repeated attempts from the same IP', async () => {
    for (let i = 0; i < 10; i += 1) {
      await acceptRequest({ token: 'bad-token', password: 'Password123!' });
    }
    const response = await acceptRequest({ token: 'bad-token', password: 'Password123!' });
    expect(response.status).toBe(429);
  });
});
