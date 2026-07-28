import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `rbac-my-permissions-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: vi.fn(),
}));

const { GET } = await import('./route');

function getRequest(organizationId?: string) {
  const url = organizationId ? `http://localhost/api/rbac/my-permissions?organizationId=${organizationId}` : 'http://localhost/api/rbac/my-permissions';
  return GET(new Request(url));
}

let lengths: { identity: number; membership: number; sessions: number };
beforeEach(() => {
  idCounter = 0;
  mockSession = null;
  lengths = { identity: identityFixtures.length, membership: membershipFixtures.length, sessions: identitySessionFixtures.length };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
});

async function seedCaller(role: string) {
  const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
  const { createMembership } = await import('@/services/membershipService');
  const { createIdentitySession } = await import('@/services/sessionService');
  const { identity } = await findOrCreateIdentity({ email: `caller-${idFactory()}@example.com`, displayName: 'Caller', idFactory }, 'mock');
  await updateIdentity(identity.id, { status: 'active' }, 'mock');
  await createMembership({ identityId: identity.id, organizationId: DEFAULT_ORGANIZATION_ID, role, status: 'active', invitedBy: null, idFactory }, 'mock');
  const session = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
  return identity;
}

describe('GET /api/rbac/my-permissions', () => {
  it('returns 401 with no session', async () => {
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 400 with no organizationId', async () => {
    await seedCaller('readOnly');
    expect((await getRequest()).status).toBe(400);
  });

  it('returns 403 for an organization the caller has no membership in', async () => {
    await seedCaller('readOnly');
    expect((await getRequest('some-other-org')).status).toBe(403);
  });

  it("returns the caller's resolved permission set and identityId for the organization", async () => {
    const caller = await seedCaller('funeralDirector');
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.identityId).toBe(caller.id);
    expect(body.roleKey).toBe('funeralDirector');
    expect(body.permissions).toContain('case.read');
    expect(body.permissions).not.toContain('organization.manage');
  });
});
