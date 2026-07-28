import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { roleFixtures, rolePermissionFixtures, organizationRoleFixtures, organizationRoleAuditEntryFixtures } from '@/services/__mocks__/rbacFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `rbac-roles-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: vi.fn(),
}));

const { GET, POST } = await import('./route');

function getRequest(url: string) {
  return GET(new Request(url));
}
function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/rbac/roles', { method: 'POST', headers, body: JSON.stringify(body) }));
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

describe('GET /api/rbac/roles', () => {
  it('returns 401 with no session', async () => {
    expect((await getRequest(`http://localhost/api/rbac/roles?organizationId=${DEFAULT_ORGANIZATION_ID}`)).status).toBe(401);
  });

  it('returns 400 with no organizationId', async () => {
    await seedCaller('readOnly');
    expect((await getRequest('http://localhost/api/rbac/roles')).status).toBe(400);
  });

  it("any active member (even readOnly) can list the organization's roles", async () => {
    await seedCaller('readOnly');
    const response = await getRequest(`http://localhost/api/rbac/roles?organizationId=${DEFAULT_ORGANIZATION_ID}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.roles).toHaveLength(7);
  });
});

describe('POST /api/rbac/roles', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    await seedCaller('administrator');
    const response = await postRequest(
      { organizationId: DEFAULT_ORGANIZATION_ID, name: 'X', permissions: ['case.read'] },
      { origin: 'https://evil.example.com', host: 'localhost' },
    );
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    expect((await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, name: 'X', permissions: ['case.read'] })).status).toBe(401);
  });

  it('rejects an invalid permission key', async () => {
    await seedCaller('administrator');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, name: 'X', permissions: ['not.real'] });
    expect(response.status).toBe(400);
  });

  it('a readOnly caller may not create a custom role', async () => {
    await seedCaller('readOnly');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, name: 'X', permissions: ['case.read'] });
    expect(response.status).toBe(403);
  });

  it('an administrator can create a custom role', async () => {
    await seedCaller('administrator');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, name: 'Night Shift', description: 'After hours', permissions: ['case.read', 'case.create'] });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.role.name).toBe('Night Shift');
    expect(body.role.isSystemDefault).toBe(false);
  });
});
