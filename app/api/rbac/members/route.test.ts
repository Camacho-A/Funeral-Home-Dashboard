import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `rbac-members-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: vi.fn(),
}));

const { GET } = await import('./route');

function getRequest(organizationId?: string, includeDisabled?: boolean) {
  const params = new URLSearchParams();
  if (organizationId) params.set('organizationId', organizationId);
  if (includeDisabled) params.set('includeDisabled', 'true');
  return GET(new Request(`http://localhost/api/rbac/members?${params.toString()}`));
}

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
  return identity;
}

describe('GET /api/rbac/members', () => {
  it('returns 401 with no session', async () => {
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 400 with no organizationId', async () => {
    await seedCaller('readOnly');
    expect((await getRequest()).status).toBe(400);
  });

  it('lists active members with their resolved display name and current role', async () => {
    const caller = await seedCaller('administrator');
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    const self = body.members.find((m: { identityId: string }) => m.identityId === caller.id);
    expect(self.role).toBe('administrator');
    expect(self.displayName).toBe('Caller');
  });

  it('excludes invited (not-yet-active) memberships', async () => {
    await seedCaller('administrator');
    const { findOrCreateIdentity } = await import('@/services/identityService');
    const { createMembership } = await import('@/services/membershipService');
    const { identity: invited } = await findOrCreateIdentity({ email: `invited-${idFactory()}@example.com`, displayName: 'Invited', idFactory }, 'mock');
    await createMembership({ identityId: invited.id, organizationId: DEFAULT_ORGANIZATION_ID, role: 'readOnly', status: 'invited', invitedBy: null, idFactory }, 'mock');

    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.members.some((m: { identityId: string }) => m.identityId === invited.id)).toBe(false);
  });

  it('Phase 23: excludes disabled memberships by default, but includes them (with their status) when includeDisabled=true', async () => {
    await seedCaller('administrator');
    const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
    const { createMembership } = await import('@/services/membershipService');
    const { identity: disabledIdentity } = await findOrCreateIdentity({ email: `disabled-${idFactory()}@example.com`, displayName: 'Disabled Member', idFactory }, 'mock');
    await updateIdentity(disabledIdentity.id, { status: 'active' }, 'mock');
    const { membership } = await createMembership({ identityId: disabledIdentity.id, organizationId: DEFAULT_ORGANIZATION_ID, role: 'readOnly', status: 'active', invitedBy: null, idFactory }, 'mock');
    const { updateMembership } = await import('@/services/membershipService');
    await updateMembership(membership.id, { status: 'disabled' }, 'mock');

    const defaultResponse = await getRequest(DEFAULT_ORGANIZATION_ID);
    const defaultBody = await defaultResponse.json();
    expect(defaultBody.members.some((m: { identityId: string }) => m.identityId === disabledIdentity.id)).toBe(false);

    const includeResponse = await getRequest(DEFAULT_ORGANIZATION_ID, true);
    const includeBody = await includeResponse.json();
    const disabledRow = includeBody.members.find((m: { identityId: string }) => m.identityId === disabledIdentity.id);
    expect(disabledRow).toBeTruthy();
    expect(disabledRow.status).toBe('disabled');
  });
});
