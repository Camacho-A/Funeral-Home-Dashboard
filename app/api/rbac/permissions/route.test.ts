import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `rbac-permissions-route-test-${idCounter}`;
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

async function seedCaller() {
  const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
  const { createMembership } = await import('@/services/membershipService');
  const { createIdentitySession } = await import('@/services/sessionService');
  const { identity } = await findOrCreateIdentity({ email: `caller-${idFactory()}@example.com`, displayName: 'Caller', idFactory }, 'mock');
  await updateIdentity(identity.id, { status: 'active' }, 'mock');
  await createMembership({ identityId: identity.id, organizationId: DEFAULT_ORGANIZATION_ID, role: 'readOnly', status: 'active', invitedBy: null, idFactory }, 'mock');
  const session = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
}

describe('GET /api/rbac/permissions', () => {
  it('returns 401 with no session', async () => {
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('returns 401 for a mock/wix-mode session (identity-only route)', async () => {
    mockSession = { user: { id: 'mock-user', email: 'a@example.com', displayName: 'A', source: 'mock' } };
    expect((await GET()).status).toBe(401);
  });

  it('returns the full permission catalog for any authenticated identity, regardless of role', async () => {
    await seedCaller();
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.permissions).toHaveLength(32); // Phase 26: 28 + signature.request + signature.read + signature.cancel + signature.manage
    expect(body.permissions.some((p: { key: string }) => p.key === 'organization.manage')).toBe(true);
  });
});
