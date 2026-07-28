import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { organizationRoleAuditEntryFixtures } from '@/services/__mocks__/rbacFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `rbac-assignments-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: vi.fn(),
}));

const { POST, DELETE } = await import('./route');

function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/rbac/assignments', { method: 'POST', headers, body: JSON.stringify(body) }));
}
function deleteRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return DELETE(new Request('http://localhost/api/rbac/assignments', { method: 'DELETE', headers, body: JSON.stringify(body) }));
}

let lengths: { identity: number; membership: number; sessions: number; audit: number };
beforeEach(() => {
  idCounter = 0;
  mockSession = null;
  lengths = {
    identity: identityFixtures.length,
    membership: membershipFixtures.length,
    sessions: identitySessionFixtures.length,
    audit: organizationRoleAuditEntryFixtures.length,
  };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
  organizationRoleAuditEntryFixtures.length = lengths.audit;
});

async function seedIdentityWithRole(role: string) {
  const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
  const { createMembership } = await import('@/services/membershipService');
  const { identity } = await findOrCreateIdentity({ email: `member-${idFactory()}@example.com`, displayName: 'Member', idFactory }, 'mock');
  await updateIdentity(identity.id, { status: 'active' }, 'mock');
  await createMembership({ identityId: identity.id, organizationId: DEFAULT_ORGANIZATION_ID, role, status: 'active', invitedBy: null, idFactory }, 'mock');
  return identity;
}

async function seedCallerSession(role: string) {
  const { createIdentitySession } = await import('@/services/sessionService');
  const identity = await seedIdentityWithRole(role);
  const session = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
  return identity;
}

describe('POST /api/rbac/assignments', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const caller = await seedCallerSession('administrator');
    const target = await seedIdentityWithRole('readOnly');
    const response = await postRequest(
      { organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: target.id, roleKey: 'funeralDirector' },
      { origin: 'https://evil.example.com', host: 'localhost' },
    );
    expect(response.status).toBe(403);
    void caller;
  });

  it('returns 401 with no session', async () => {
    const target = await seedIdentityWithRole('readOnly');
    expect((await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: target.id, roleKey: 'funeralDirector' })).status).toBe(401);
  });

  it('a manager without user.manageRoles may not assign a role', async () => {
    await seedCallerSession('manager');
    const target = await seedIdentityWithRole('readOnly');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: target.id, roleKey: 'funeralDirector' });
    expect(response.status).toBe(403);
  });

  it('returns 404 for a target with no membership in this organization', async () => {
    await seedCallerSession('administrator');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: 'no-such-identity', roleKey: 'funeralDirector' });
    expect(response.status).toBe(404);
  });

  it('an administrator can assign a new role to a member, recording an audit entry', async () => {
    await seedCallerSession('administrator');
    const target = await seedIdentityWithRole('readOnly');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: target.id, roleKey: 'funeralDirector' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.membership.role).toBe('funeralDirector');
    expect(body.auditEntry.action).toBe('role_assigned');
    expect(body.auditEntry.previousRoleKey).toBe('readOnly');
  });

  it('rejects an unknown roleKey', async () => {
    await seedCallerSession('administrator');
    const target = await seedIdentityWithRole('readOnly');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: target.id, roleKey: 'not-a-real-role' });
    expect(response.status).toBe(409);
  });
});

describe('DELETE /api/rbac/assignments', () => {
  it('an administrator can remove a member\'s role, falling back to readOnly', async () => {
    await seedCallerSession('administrator');
    const target = await seedIdentityWithRole('funeralDirector');
    const response = await deleteRequest({ organizationId: DEFAULT_ORGANIZATION_ID, targetIdentityId: target.id });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.membership.role).toBe('readOnly');
    expect(body.auditEntry.action).toBe('role_removed');
  });
});
