import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalUserFixtures, portalSessionFixtures, portalAccessFixtures } from '@/services/__mocks__/portalFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { hashPassword } from '@/lib/identity/passwordHashing';
import { record } from '@/services/activityService';

let familySession: { portalUserId: string; sessionId: string; aud: 'family'; issuedAt: number; expiresAt: number } | null = null;
vi.mock('@/lib/auth/familySession', () => ({
  getFamilySession: async () => familySession,
  clearFamilySession: async () => undefined,
}));

const { GET } = await import('./route');

const TEST_CASE_ID = 'case-family-timeline-route-test';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-timeline-route-test-${idCounter}`;
}

function getRequest() {
  return GET(new Request(`http://localhost/api/family/cases/${TEST_CASE_ID}/timeline`), { params: Promise.resolve({ caseId: TEST_CASE_ID }) });
}

let lengths: { users: number; sessions: number; access: number; events: number };
beforeEach(() => {
  idCounter = 0;
  familySession = null;
  lengths = { users: portalUserFixtures.length, sessions: portalSessionFixtures.length, access: portalAccessFixtures.length, events: activityEventFixtures.length };
});
afterEach(() => {
  portalUserFixtures.length = lengths.users;
  portalSessionFixtures.length = lengths.sessions;
  portalAccessFixtures.length = lengths.access;
  activityEventFixtures.length = lengths.events;
});

describe('GET /api/family/cases/[caseId]/timeline', () => {
  it('returns 401 with no family session', async () => {
    expect((await getRequest()).status).toBe(401);
  });

  it('returns only family-visible event types for an authorized portal user', async () => {
    const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
    const { createPortalSession } = await import('@/services/portal/portalSessionService');
    const { portalUser } = await findOrCreatePortalUser(
      { email: 'family-timeline@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );
    const session = await createPortalSession({ portalUserId: portalUser.id, deviceId: 'device-1', idFactory }, 'mock');
    familySession = { portalUserId: portalUser.id, sessionId: session.id, aud: 'family', issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };
    portalAccessFixtures.push({
      id: 'access-1',
      portalUserId: portalUser.id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: TEST_CASE_ID,
      relationshipType: 'primary_next_of_kin',
      status: 'active',
      grantedFromInvitationId: 'invitation-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    await record(
      { organizationId: DEFAULT_ORGANIZATION_ID, caseId: TEST_CASE_ID, actorIdentityId: 'identity-1', actorMembershipId: null, actorRoleKey: 'funeralDirector', category: 'documents', eventType: 'document.generated', resourceType: 'caseDocument', resourceId: 'doc-1', previousValue: null, newValue: null, description: 'Document generated', metadata: null, severity: 'info', correlationId: 'corr-1', isSystemGenerated: false },
      'mock',
    );
    await record(
      { organizationId: DEFAULT_ORGANIZATION_ID, caseId: TEST_CASE_ID, actorIdentityId: 'identity-1', actorMembershipId: null, actorRoleKey: 'funeralDirector', category: 'cases', eventType: 'case.note.added', resourceType: 'caseLogEntry', resourceId: 'note-1', previousValue: null, newValue: null, description: 'Note added', metadata: null, severity: 'info', correlationId: 'corr-2', isSystemGenerated: false },
      'mock',
    );

    const response = await getRequest();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.events.map((e: { eventType: string }) => e.eventType)).toEqual(['document.generated']);
    expect(body.events[0]).not.toHaveProperty('actorIdentityId');
    expect(body.events[0]).not.toHaveProperty('actorMembershipId');
    expect(body.events[0]).not.toHaveProperty('actorRoleKey');
    expect(body.events[0]).not.toHaveProperty('correlationId');
    expect(body.events[0]).not.toHaveProperty('metadata');
    expect(body.events[0]).not.toHaveProperty('resourceId');
  });
});
