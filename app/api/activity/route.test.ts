import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { record } from '@/services/activityService';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `activity-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: vi.fn(),
}));

const { GET } = await import('./route');

function getRequest(organizationId: string | null, extraParams: Record<string, string> = {}) {
  const params = new URLSearchParams({ ...(organizationId ? { organizationId } : {}), ...extraParams });
  return GET(new Request(`http://localhost/api/activity?${params.toString()}`));
}

let lengths: { identity: number; membership: number; sessions: number; events: number };
beforeEach(() => {
  idCounter = 0;
  mockSession = null;
  lengths = {
    identity: identityFixtures.length,
    membership: membershipFixtures.length,
    sessions: identitySessionFixtures.length,
    events: activityEventFixtures.length,
  };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
  activityEventFixtures.length = lengths.events;
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

async function seedEvent(overrides: Partial<Parameters<typeof record>[0]> = {}) {
  return record(
    {
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: null,
      actorIdentityId: 'identity-1',
      actorMembershipId: null,
      actorRoleKey: 'administrator',
      category: 'cases',
      eventType: 'case.updated',
      resourceType: 'case',
      resourceId: 'case-1',
      previousValue: null,
      newValue: null,
      description: 'Case updated',
      metadata: null,
      severity: 'info',
      correlationId: null,
      isSystemGenerated: false,
      ...overrides,
    },
    'mock',
  );
}

describe('GET /api/activity', () => {
  it('returns 401 with no session', async () => {
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 400 with no organizationId', async () => {
    await seedCaller('administrator');
    expect((await getRequest(null)).status).toBe(400);
  });

  it('a role without audit.read (e.g. arranger) is refused', async () => {
    await seedCaller('arranger');
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('administrator (holds audit.read) can list organization-wide activity', async () => {
    await seedCaller('administrator');
    await seedEvent({ description: 'Event A' });
    await seedEvent({ description: 'Event B' });

    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.events).toHaveLength(2);
  });

  it('filters by category', async () => {
    await seedCaller('administrator');
    await seedEvent({ category: 'payments', eventType: 'payment.recorded' });
    await seedEvent({ category: 'cases', eventType: 'case.updated' });

    const response = await getRequest(DEFAULT_ORGANIZATION_ID, { category: 'payments' });
    const body = await response.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].category).toBe('payments');
  });

  it('rejects an invalid category value with 400', async () => {
    await seedCaller('administrator');
    const response = await getRequest(DEFAULT_ORGANIZATION_ID, { category: 'not-a-real-category' });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid severity value with 400', async () => {
    await seedCaller('administrator');
    const response = await getRequest(DEFAULT_ORGANIZATION_ID, { severity: 'catastrophic' });
    expect(response.status).toBe(400);
  });
});
