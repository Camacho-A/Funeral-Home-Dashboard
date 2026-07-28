import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { organizationRoleAuditEntryFixtures, organizationRoleLockFixtures, organizationRoleWriteClaimFixtures } from '@/services/__mocks__/rbacFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `membership-status-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: vi.fn(),
}));

const { PATCH } = await import('./route');

function patchRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request('http://localhost/api/rbac/membership-status', { method: 'PATCH', headers, body: JSON.stringify(body) }));
}

let lengths: { identity: number; membership: number; sessions: number; audit: number; locks: number; claims: number };
beforeEach(() => {
  idCounter = 0;
  mockSession = null;
  lengths = {
    identity: identityFixtures.length,
    membership: membershipFixtures.length,
    sessions: identitySessionFixtures.length,
    audit: organizationRoleAuditEntryFixtures.length,
    locks: organizationRoleLockFixtures.length,
    claims: organizationRoleWriteClaimFixtures.length,
  };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
  organizationRoleAuditEntryFixtures.length = lengths.audit;
  organizationRoleLockFixtures.length = lengths.locks;
  organizationRoleWriteClaimFixtures.length = lengths.claims;
});

async function seedIdentityWithRole(role: string, status: 'active' | 'disabled' | 'removed' = 'active') {
  const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
  const { createMembership, updateMembership } = await import('@/services/membershipService');
  const { identity } = await findOrCreateIdentity({ email: `member-${idFactory()}@example.com`, displayName: 'Member', idFactory }, 'mock');
  await updateIdentity(identity.id, { status: 'active' }, 'mock');
  const { membership } = await createMembership({ identityId: identity.id, organizationId: DEFAULT_ORGANIZATION_ID, role, status: 'active', invitedBy: null, idFactory }, 'mock');
  if (status !== 'active') await updateMembership(membership.id, { status }, 'mock');
  return identity;
}

async function seedCallerSession(role: string) {
  const { createIdentitySession } = await import('@/services/sessionService');
  const identity = await seedIdentityWithRole(role);
  const session = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
  return identity;
}

describe('PATCH /api/rbac/membership-status', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    await seedCallerSession('administrator');
    const target = await seedIdentityWithRole('readOnly');
    const response = await patchRequest(
      { organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: target.id, status: 'disabled' },
      { origin: 'https://evil.example.com', host: 'localhost' },
    );
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    const target = await seedIdentityWithRole('readOnly');
    expect((await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: target.id, status: 'disabled' })).status).toBe(401);
  });

  it('a manager without user.remove may not change a membership\'s status', async () => {
    await seedCallerSession('manager');
    const target = await seedIdentityWithRole('readOnly');
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: target.id, status: 'disabled' });
    expect(response.status).toBe(403);
  });

  it('rejects an invalid status value', async () => {
    await seedCallerSession('administrator');
    const target = await seedIdentityWithRole('readOnly');
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: target.id, status: 'bogus' });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a target with no membership in this organization', async () => {
    await seedCallerSession('administrator');
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: 'no-such-identity', status: 'disabled' });
    expect(response.status).toBe(404);
  });

  it('refuses a caller targeting their own membership', async () => {
    const caller = await seedCallerSession('administrator');
    await seedIdentityWithRole('administrator'); // a second admin, so the invariant itself would not otherwise block this
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: caller.id, status: 'disabled' });
    expect(response.status).toBe(400);
  });

  it('an administrator can disable a member, recording a membership_disabled audit entry', async () => {
    await seedCallerSession('administrator');
    const target = await seedIdentityWithRole('readOnly');
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: target.id, status: 'disabled' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.membership.status).toBe('disabled');
    expect(body.auditEntry.action).toBe('membership_disabled');
  });

  it('reactivates a disabled member, recording a membership_reactivated audit entry', async () => {
    await seedCallerSession('administrator');
    const target = await seedIdentityWithRole('readOnly', 'disabled');
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: target.id, status: 'active' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.membership.status).toBe('active');
    expect(body.auditEntry.action).toBe('membership_reactivated');
  });

  it('removes a member, recording a membership_removed audit entry', async () => {
    await seedCallerSession('administrator');
    const target = await seedIdentityWithRole('readOnly');
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: target.id, status: 'removed' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.membership.status).toBe('removed');
    expect(body.auditEntry.action).toBe('membership_removed');
  });

  it("'removed' is terminal — attempting to reactivate a removed membership is refused (409)", async () => {
    await seedCallerSession('administrator');
    const target = await seedIdentityWithRole('readOnly', 'removed');
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: target.id, status: 'active' });
    expect(response.status).toBe(409);
  });

  it('refuses to disable the last active administrator (409), preserving the invariant', async () => {
    const orgId = 'membership-status-sole-admin-org';
    const { seedDefaultRoles, createCustomRole } = await import('@/services/roleService');
    await seedDefaultRoles(orgId, 'mock');

    // A custom role granting user.remove but *not* organization.manage —
    // lets the caller pass this route's permission gate without themselves
    // counting toward the admin-tier invariant, isolating the invariant
    // check itself from the self-target guard (caller !== target here).
    const removerRole = await createCustomRole(
      { organizationId: orgId, name: 'Remover', description: '', permissions: ['user.remove'], actorIdentityId: 'seed', idFactory },
      'mock',
    );

    const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
    const { createMembership } = await import('@/services/membershipService');
    const { createIdentitySession } = await import('@/services/sessionService');

    const { identity: caller } = await findOrCreateIdentity({ email: `caller-${idFactory()}@example.com`, displayName: 'Caller', idFactory }, 'mock');
    await updateIdentity(caller.id, { status: 'active' }, 'mock');
    await createMembership({ identityId: caller.id, organizationId: orgId, role: removerRole.key, status: 'active', invitedBy: null, idFactory }, 'mock');
    const session = await createIdentitySession({ identityId: caller.id, deviceId: 'd1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
    mockSession = { user: { id: caller.id, email: caller.email, displayName: caller.displayName, source: 'identity' }, sessionId: session.id };

    const { identity: soleAdmin } = await findOrCreateIdentity({ email: `sole-admin-${idFactory()}@example.com`, displayName: 'Sole Admin', idFactory }, 'mock');
    await updateIdentity(soleAdmin.id, { status: 'active' }, 'mock');
    await createMembership({ identityId: soleAdmin.id, organizationId: orgId, role: 'administrator', status: 'active', invitedBy: null, idFactory }, 'mock');

    const response = await patchRequest({ organizationId: orgId, targetIdentityId: soleAdmin.id, status: 'disabled' });
    expect(response.status).toBe(409);
  });

  it('is idempotent — setting a membership to its current status is a no-op', async () => {
    await seedCallerSession('administrator');
    const target = await seedIdentityWithRole('readOnly');
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: target.id, status: 'active' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.auditEntry).toBeNull();
  });
});
