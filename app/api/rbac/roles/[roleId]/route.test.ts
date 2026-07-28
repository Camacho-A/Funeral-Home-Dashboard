import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { roleFixtures, rolePermissionFixtures, organizationRoleFixtures, organizationRoleAuditEntryFixtures } from '@/services/__mocks__/rbacFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `rbac-roleid-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: vi.fn(),
}));

const { PATCH, DELETE } = await import('./route');

function patchRequest(roleId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request(`http://localhost/api/rbac/roles/${roleId}`, { method: 'PATCH', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ roleId }) });
}
function deleteRequest(roleId: string, organizationId: string, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return DELETE(new Request(`http://localhost/api/rbac/roles/${roleId}?organizationId=${organizationId}`, { method: 'DELETE', headers }), { params: Promise.resolve({ roleId }) });
}

let lengths: { identity: number; membership: number; sessions: number; role: number; rolePermission: number; organizationRole: number; audit: number };
beforeEach(() => {
  idCounter = 0;
  mockSession = null;
  lengths = {
    identity: identityFixtures.length,
    membership: membershipFixtures.length,
    sessions: identitySessionFixtures.length,
    role: roleFixtures.length,
    rolePermission: rolePermissionFixtures.length,
    organizationRole: organizationRoleFixtures.length,
    audit: organizationRoleAuditEntryFixtures.length,
  };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
  roleFixtures.length = lengths.role;
  rolePermissionFixtures.length = lengths.rolePermission;
  organizationRoleFixtures.length = lengths.organizationRole;
  organizationRoleAuditEntryFixtures.length = lengths.audit;
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

async function createCustomRoleForOrg(organizationId: string) {
  const { createCustomRole } = await import('@/services/roleService');
  return createCustomRole({ organizationId, name: 'Custom Test Role', description: 'desc', permissions: ['case.read'], actorIdentityId: 'seed-actor', idFactory }, 'mock');
}

describe('PATCH /api/rbac/roles/[roleId]', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    await seedCaller('administrator');
    const custom = await createCustomRoleForOrg(DEFAULT_ORGANIZATION_ID);
    const response = await patchRequest(custom.id, { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Y' }, { origin: 'https://evil.example.com', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('refuses to modify a platform-default role', async () => {
    await seedCaller('administrator');
    const roles = await import('@/services/roleService').then((m) => m.listRolesForOrganization(DEFAULT_ORGANIZATION_ID, 'mock'));
    const administrator = roles.find((r) => r.key === 'administrator')!;
    const response = await patchRequest(administrator.id, { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Hacked' });
    expect(response.status).toBe(409);
  });

  it('a manager (no user.manageRoles) may not update a role', async () => {
    await seedCaller('manager');
    const custom = await createCustomRoleForOrg(DEFAULT_ORGANIZATION_ID);
    const response = await patchRequest(custom.id, { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Y' });
    expect(response.status).toBe(403);
  });

  it('an administrator can rename a custom role and edit its permissions', async () => {
    await seedCaller('administrator');
    const custom = await createCustomRoleForOrg(DEFAULT_ORGANIZATION_ID);
    const response = await patchRequest(custom.id, { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Renamed', addPermissions: ['case.update'] });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.role.name).toBe('Renamed');
  });
});

describe('DELETE /api/rbac/roles/[roleId]', () => {
  it('refuses to delete a platform-default role', async () => {
    await seedCaller('administrator');
    const roles = await import('@/services/roleService').then((m) => m.listRolesForOrganization(DEFAULT_ORGANIZATION_ID, 'mock'));
    const readOnly = roles.find((r) => r.key === 'readOnly')!;
    const response = await deleteRequest(readOnly.id, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(409);
  });

  it('deletes an unassigned custom role', async () => {
    await seedCaller('administrator');
    const custom = await createCustomRoleForOrg(DEFAULT_ORGANIZATION_ID);
    const response = await deleteRequest(custom.id, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
  });
});
