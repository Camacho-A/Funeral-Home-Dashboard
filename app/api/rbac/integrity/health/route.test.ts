import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
const idFactory = () => `rbac-health-route-test-${(idCounter += 1)}`;

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession, clearSession: vi.fn() }));

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

const req = (org?: string) => GET(new Request(`http://localhost/api/rbac/integrity/health${org ? `?organizationId=${org}` : ''}`));

describe('GET /api/rbac/integrity/health', () => {
  it('401 with no session', async () => {
    expect((await req(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('400 without organizationId', async () => {
    await seedCaller('administrator');
    expect((await req()).status).toBe(400);
  });

  it('403 for a non-admin caller (no organization.manage)', async () => {
    await seedCaller('readOnly');
    expect((await req(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('200 + health report for an administrator', async () => {
    await seedCaller('administrator');
    const response = await req(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.health.status).toBeDefined();
    expect(body.health.counts.rolesScanned).toBe(8);
  });
});
