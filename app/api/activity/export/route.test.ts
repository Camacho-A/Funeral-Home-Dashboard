import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '@/services/__mocks__/identityFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { record } from '@/services/activityService';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `activity-export-route-test-${idCounter}`;
}

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  clearSession: vi.fn(),
}));

const { GET } = await import('./route');

function getRequest(organizationId: string | null) {
  const params = new URLSearchParams({ ...(organizationId ? { organizationId } : {}) });
  return GET(new Request(`http://localhost/api/activity/export?${params.toString()}`));
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

describe('GET /api/activity/export', () => {
  it('returns 401 with no session', async () => {
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('a role with audit.read but not audit.export (e.g. funeralDirector) is refused', async () => {
    await seedCaller('funeralDirector');
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('administrator (holds audit.export) receives a well-formed CSV', async () => {
    await seedCaller('administrator');
    await record(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-1',
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
      },
      'mock',
    );

    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    expect(response.headers.get('Content-Disposition')).toContain('attachment');
    const csv = await response.text();
    const lines = csv.split('\n');
    expect(lines[0]).toBe('createdAt,category,eventType,severity,actorIdentityId,actorRoleKey,caseId,resourceType,resourceId,description');
    expect(lines).toHaveLength(2);
  });
});
