import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { roleFixtures, rolePermissionFixtures, organizationRoleFixtures, organizationRoleAuditEntryFixtures } from '@/services/__mocks__/rbacFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `rbac-clone-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: vi.fn(),
}));

const { POST } = await import('./route');

function cloneRequest(roleId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/rbac/roles/${roleId}/clone`, { method: 'POST', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ roleId }) });
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
}

describe('POST /api/rbac/roles/[roleId]/clone', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    await seedCaller('administrator');
    const roles = await import('@/services/roleService').then((m) => m.listRolesForOrganization(DEFAULT_ORGANIZATION_ID, 'mock'));
    const officeStaff = roles.find((r) => r.key === 'officeStaff')!;
    const response = await cloneRequest(officeStaff.id, { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Clone' }, { origin: 'https://evil.example.com', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('a readOnly caller may not clone a role', async () => {
    await seedCaller('readOnly');
    const roles = await import('@/services/roleService').then((m) => m.listRolesForOrganization(DEFAULT_ORGANIZATION_ID, 'mock'));
    const officeStaff = roles.find((r) => r.key === 'officeStaff')!;
    const response = await cloneRequest(officeStaff.id, { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Clone' });
    expect(response.status).toBe(403);
  });

  it('an administrator can clone a platform-default role into a custom role', async () => {
    await seedCaller('administrator');
    const roles = await import('@/services/roleService').then((m) => m.listRolesForOrganization(DEFAULT_ORGANIZATION_ID, 'mock'));
    const officeStaff = roles.find((r) => r.key === 'officeStaff')!;
    const response = await cloneRequest(officeStaff.id, { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Office Staff Extended' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.role.isSystemDefault).toBe(false);
    expect(body.role.name).toBe('Office Staff Extended');
  });
});
