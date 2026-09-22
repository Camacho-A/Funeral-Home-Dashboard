import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { organizationRolePermissionOverrideFixtures, organizationRoleAuditEntryFixtures } from '@/services/__mocks__/rbacFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { upsertOverride } from '@/services/organizationRoleOverrideService';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `override-delete-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  createSession: vi.fn(),
  clearSession: vi.fn(),
}));

const { DELETE } = await import('./route');

function deleteRequest(overrideId: string, organizationId: string) {
  return DELETE(
    new Request(`http://localhost/api/rbac/organization-role-overrides/${overrideId}?organizationId=${organizationId}`, {
      method: 'DELETE',
      headers: { origin: 'http://localhost', host: 'localhost' },
    }),
    { params: Promise.resolve({ overrideId }) },
  );
}

let lengths: { identity: number; membership: number; sessions: number; overrides: number; audit: number };
beforeEach(() => {
  idCounter = 0;
  mockSession = null;
  lengths = {
    identity: identityFixtures.length,
    membership: membershipFixtures.length,
    sessions: identitySessionFixtures.length,
    overrides: organizationRolePermissionOverrideFixtures.length,
    audit: organizationRoleAuditEntryFixtures.length,
  };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
  organizationRolePermissionOverrideFixtures.length = lengths.overrides;
  organizationRoleAuditEntryFixtures.length = lengths.audit;
});

async function seedCaller(role: string, organizationId: string = DEFAULT_ORGANIZATION_ID) {
  const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
  const { createMembership } = await import('@/services/membershipService');
  const { createIdentitySession } = await import('@/services/sessionService');
  const { identity } = await findOrCreateIdentity({ email: `caller-${idFactory()}@example.com`, displayName: 'Caller', idFactory }, 'mock');
  await updateIdentity(identity.id, { status: 'active' }, 'mock');
  await createMembership({ identityId: identity.id, organizationId, role, status: 'active', invitedBy: null, idFactory }, 'mock');
  const session = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', passwordVersionAtIssue: 0, idFactory }, 'mock');
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
  return identity;
}

describe('DELETE /api/rbac/organization-role-overrides/[overrideId]', () => {
  it('returns 401 with no session', async () => {
    expect((await deleteRequest('some-id', DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 400 with no organizationId', async () => {
    await seedCaller('administrator');
    const response = await DELETE(
      new Request('http://localhost/api/rbac/organization-role-overrides/some-id', { method: 'DELETE', headers: { origin: 'http://localhost', host: 'localhost' } }),
      { params: Promise.resolve({ overrideId: 'some-id' }) },
    );
    expect(response.status).toBe(400);
  });

  it('an officeStaff caller cannot delete an override', async () => {
    await seedCaller('officeStaff');
    const response = await deleteRequest('some-id', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(403);
  });

  it('an administrator can remove their own organization\'s override', async () => {
    const admin = await seedCaller('administrator');
    const created = await upsertOverride(
      { organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'revoke', actorIdentityId: admin.id, idFactory },
      'mock',
    );
    const response = await deleteRequest(created.id, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    expect(organizationRolePermissionOverrideFixtures.some((o) => o.id === created.id)).toBe(false);
  });

  it('an administrator authenticated only for Organization B is rejected outright when targeting Organization A\'s override, before the override-ownership check is even reached', async () => {
    await seedCaller('administrator', SECOND_MOCK_ORGANIZATION_ID);
    const created = await upsertOverride(
      { organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'revoke', actorIdentityId: 'some-other-admin', idFactory },
      'mock',
    );

    // Caller is authenticated for SECOND_MOCK_ORGANIZATION_ID, but
    // supplies DEFAULT_ORGANIZATION_ID's real override id and
    // organizationId — resolveMembershipAuthorizationContext rejects
    // this at the membership layer (no active membership in
    // DEFAULT_ORGANIZATION_ID at all) before the route ever calls
    // removeOverrideById's own cross-org check.
    const response = await deleteRequest(created.id, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(403);
    expect(organizationRolePermissionOverrideFixtures.some((o) => o.id === created.id)).toBe(true);
  });
});
