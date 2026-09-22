import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { organizationRolePermissionOverrideFixtures, organizationRoleAuditEntryFixtures } from '@/services/__mocks__/rbacFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `override-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  createSession: vi.fn(),
  clearSession: vi.fn(),
}));

const { GET, POST } = await import('./route');

function getRequest(url: string) {
  return GET(new Request(url));
}
function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' }) {
  return POST(new Request('http://localhost/api/rbac/organization-role-overrides', { method: 'POST', headers, body: JSON.stringify(body) }));
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

describe('GET /api/rbac/organization-role-overrides', () => {
  it('returns 401 with no session', async () => {
    expect((await getRequest(`http://localhost/api/rbac/organization-role-overrides?organizationId=${DEFAULT_ORGANIZATION_ID}`)).status).toBe(401);
  });

  it('returns 400 with no organizationId', async () => {
    await seedCaller('administrator');
    expect((await getRequest('http://localhost/api/rbac/organization-role-overrides')).status).toBe(400);
  });

  it('an officeStaff caller cannot list overrides', async () => {
    await seedCaller('officeStaff');
    expect((await getRequest(`http://localhost/api/rbac/organization-role-overrides?organizationId=${DEFAULT_ORGANIZATION_ID}`)).status).toBe(403);
  });

  it('a dispatch caller cannot list overrides', async () => {
    await seedCaller('dispatch');
    expect((await getRequest(`http://localhost/api/rbac/organization-role-overrides?organizationId=${DEFAULT_ORGANIZATION_ID}`)).status).toBe(403);
  });

  it('a readOnly caller cannot list overrides', async () => {
    await seedCaller('readOnly');
    expect((await getRequest(`http://localhost/api/rbac/organization-role-overrides?organizationId=${DEFAULT_ORGANIZATION_ID}`)).status).toBe(403);
  });

  it('an administrator can list overrides for their own organization', async () => {
    await seedCaller('administrator');
    const response = await getRequest(`http://localhost/api/rbac/organization-role-overrides?organizationId=${DEFAULT_ORGANIZATION_ID}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.overrides)).toBe(true);
  });

  it('an administrator from Organization A cannot read Organization B\'s overrides', async () => {
    await seedCaller('administrator', SECOND_MOCK_ORGANIZATION_ID);
    const response = await getRequest(`http://localhost/api/rbac/organization-role-overrides?organizationId=${DEFAULT_ORGANIZATION_ID}`);
    expect(response.status).toBe(403);
  });
});

describe('POST /api/rbac/organization-role-overrides', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    await seedCaller('administrator');
    const response = await postRequest(
      { organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'revoke' },
      { origin: 'https://evil.example.com', host: 'localhost' },
    );
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    expect((await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'revoke' })).status).toBe(401);
  });

  it('rejects an invalid action', async () => {
    await seedCaller('administrator');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'delete' });
    expect(response.status).toBe(400);
  });

  it('rejects an unknown role key', async () => {
    await seedCaller('administrator');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'super-admin', permissionKey: 'ap.read', action: 'revoke' });
    expect(response.status).toBe(422);
  });

  it('rejects an unknown permission key', async () => {
    await seedCaller('administrator');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'not.real', action: 'revoke' });
    expect(response.status).toBe(422);
  });

  it('an officeStaff caller cannot create an override', async () => {
    await seedCaller('officeStaff');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'revoke' });
    expect(response.status).toBe(403);
  });

  it('an administrator can create a revoke override for their own organization', async () => {
    const admin = await seedCaller('administrator');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'revoke', reason: 'Manors go-live' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.override.roleKey).toBe('readOnly');
    expect(body.override.permissionKey).toBe('ap.read');
    expect(body.override.action).toBe('revoke');
    // Audit actor derives from the authenticated server identity, never a
    // client-supplied value — the POST body above never included one.
    expect(body.override.createdBy).toBe(admin.id);
  });

  it('an administrator from Organization A cannot write an override for Organization B by supplying its id in the body', async () => {
    await seedCaller('administrator', SECOND_MOCK_ORGANIZATION_ID);
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'revoke' });
    expect(response.status).toBe(403);
    expect(organizationRolePermissionOverrideFixtures.some((o) => o.organizationId === DEFAULT_ORGANIZATION_ID && o.permissionKey === 'ap.read')).toBe(false);
  });
});
