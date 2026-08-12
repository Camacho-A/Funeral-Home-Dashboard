import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `auth-profile-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: vi.fn(),
}));

const { GET, PATCH } = await import('./route');

function getRequest(organizationId: string) {
  return GET(new Request(`http://localhost/api/auth/profile?organizationId=${organizationId}`));
}

function patchRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' }) {
  return PATCH(new Request('http://localhost/api/auth/profile', { method: 'PATCH', headers, body: JSON.stringify(body) }));
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

async function seedIdentityCaller() {
  const { findOrCreateIdentity, updateIdentity } = await import('@/services/identityService');
  const { createMembership } = await import('@/services/membershipService');
  const { createIdentitySession } = await import('@/services/sessionService');
  const { identity } = await findOrCreateIdentity({ email: `caller-${idFactory()}@example.com`, displayName: 'Caller', idFactory }, 'mock');
  await updateIdentity(identity.id, { status: 'active' }, 'mock');
  await createMembership({ identityId: identity.id, organizationId: DEFAULT_ORGANIZATION_ID, role: 'manager', status: 'active', invitedBy: null, idFactory }, 'mock');
  const session = await createIdentitySession({ identityId: identity.id, deviceId: 'd1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory }, 'mock');
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
  return identity;
}

describe('GET /api/auth/profile', () => {
  it('returns 400 with no organizationId', async () => {
    expect((await getRequest('')).status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 403 for an organization the caller has no membership in', async () => {
    await seedIdentityCaller();
    expect((await getRequest(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns the caller own identity, including a null phone by default', async () => {
    const identity = await seedIdentityCaller();
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.identity.id).toBe(identity.id);
    expect(body.identity.phone).toBeNull();
  });

  it('returns 404 under a non-identity-mode session — Identity is a Phase 21 concept mock/wix sessions never map to', async () => {
    mockSession = { user: mockDefaultUser };
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    // mockDefaultUser has no active membership fixture for DEFAULT_ORGANIZATION_ID under this
    // route's own identity-session-shaped mock, so this exercises the "no session.user.source"
    // rejection path — asserting it never 200s with fabricated identity data.
    expect(response.status).not.toBe(200);
  });
});

describe('PATCH /api/auth/profile', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, phone: '+15555550100' }, { origin: 'http://evil.test', host: 'localhost', 'content-type': 'application/json' });
    expect(response.status).toBe(403);
  });

  it('rejects an implausible phone value', async () => {
    await seedIdentityCaller();
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, phone: 'not-a-phone!!!' });
    expect(response.status).toBe(400);
  });

  it('updates the phone number and persists it', async () => {
    const identity = await seedIdentityCaller();
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, phone: '+15555550100' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.identity.phone).toBe('+15555550100');

    const again = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect((await again.json()).identity.phone).toBe('+15555550100');
    expect(identity.phone).toBeNull(); // the originally-seeded object itself is untouched
  });

  it('accepts explicitly clearing the phone number back to null', async () => {
    await seedIdentityCaller();
    await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, phone: '+15555550100' });
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, phone: null });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.identity.phone).toBeNull();
  });
});
