import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `switch-org-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: vi.fn(),
}));

const { POST } = await import('./route');

function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/auth/switch-organization', { method: 'POST', headers, body: JSON.stringify(body) }));
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

describe('POST /api/auth/switch-organization', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'https://evil.example.com', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    expect((await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID })).status).toBe(401);
  });

  it('switches to an organization the identity has an active Membership in, persisting it to the session', async () => {
    const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
    const { createMembership } = await import('@/services/membershipService');
    const { createIdentitySession, getSessionById } = await import('@/services/sessionService');
    const { identity } = await findOrCreateIdentity({ email: 'switcher@example.com', displayName: 'Switcher', idFactory }, 'mock');
    await updateIdentity(identity.id, { status: 'active' }, 'mock');
    await createMembership({ identityId: identity.id, organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', status: 'active', invitedBy: null, idFactory }, 'mock');
    await createMembership({ identityId: identity.id, organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'owner', status: 'active', invitedBy: null, idFactory }, 'mock');
    const session = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
    mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };

    const response = await postRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'owner' });

    const persisted = await getSessionById(session.id, 'mock');
    expect(persisted?.organizationId).toBe(SECOND_MOCK_ORGANIZATION_ID);
  });

  it('rejects switching to an organization with no active Membership — never trusts the client-supplied id', async () => {
    const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
    const { createMembership } = await import('@/services/membershipService');
    const { createIdentitySession } = await import('@/services/sessionService');
    const { identity } = await findOrCreateIdentity({ email: 'noswitchaccess@example.com', displayName: 'No Switch Access', idFactory }, 'mock');
    await updateIdentity(identity.id, { status: 'active' }, 'mock');
    await createMembership({ identityId: identity.id, organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', status: 'active', invitedBy: null, idFactory }, 'mock');
    const session = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
    mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };

    const response = await postRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });
});
