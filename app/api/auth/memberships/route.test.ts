import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `memberships-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: vi.fn(),
}));

const { GET } = await import('./route');

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

describe('GET /api/auth/memberships', () => {
  it('returns 401 with no session', async () => {
    expect((await GET()).status).toBe(401);
  });

  it("lists every active organization the identity belongs to, marking the session's current one", async () => {
    const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
    const { createMembership } = await import('@/services/membershipService');
    const { createIdentitySession, setSessionOrganization } = await import('@/services/sessionService');
    const { identity } = await findOrCreateIdentity({ email: 'memberships.list@example.com', displayName: 'Memberships List', idFactory }, 'mock');
    await updateIdentity(identity.id, { status: 'active' }, 'mock');
    await createMembership({ identityId: identity.id, organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', status: 'active', invitedBy: null, idFactory }, 'mock');
    await createMembership({ identityId: identity.id, organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'owner', status: 'active', invitedBy: null, idFactory }, 'mock');
    const session = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
    await setSessionOrganization(session.id, DEFAULT_ORGANIZATION_ID, 'mock');
    mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.organizations).toHaveLength(2);
    expect(body.organizations.find((o: { organizationId: string }) => o.organizationId === DEFAULT_ORGANIZATION_ID).isCurrent).toBe(true);
    expect(body.organizations.find((o: { organizationId: string }) => o.organizationId === SECOND_MOCK_ORGANIZATION_ID).isCurrent).toBe(false);
  });

  it('excludes invited (not-yet-accepted) memberships', async () => {
    const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
    const { createMembership } = await import('@/services/membershipService');
    const { createIdentitySession } = await import('@/services/sessionService');
    const { identity } = await findOrCreateIdentity({ email: 'memberships.invited@example.com', displayName: 'Invited Only', idFactory }, 'mock');
    await updateIdentity(identity.id, { status: 'active' }, 'mock');
    await createMembership({ identityId: identity.id, organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', status: 'invited', invitedBy: null, idFactory }, 'mock');
    const session = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
    mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };

    const response = await GET();
    const body = await response.json();
    expect(body.organizations).toHaveLength(0);
  });
});
