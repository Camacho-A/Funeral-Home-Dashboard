import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalUserFixtures, portalSessionFixtures, portalAccessFixtures, portalMessageFixtures } from '@/services/__mocks__/portalFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { membershipFixtures } from '@/services/__mocks__/identityFixtures';
import { notificationFixtures, notificationRecipientFixtures } from '@/services/__mocks__/notificationFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { hashPassword } from '@/lib/identity/passwordHashing';
import { resetRateLimiter } from '@/lib/rateLimiter';

let familySession: { portalUserId: string; sessionId: string; aud: 'family'; issuedAt: number; expiresAt: number } | null = null;
vi.mock('@/lib/auth/familySession', () => ({
  getFamilySession: async () => familySession,
  clearFamilySession: async () => undefined,
}));

const { GET, POST } = await import('./route');

const TEST_CASE_ID = 'case-family-messages-route-test';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-messages-route-test-${idCounter}`;
}

function listRequest() {
  return GET(new Request(`http://localhost/api/family/cases/${TEST_CASE_ID}/messages`), { params: Promise.resolve({ caseId: TEST_CASE_ID }) });
}

function sendRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/family/cases/${TEST_CASE_ID}/messages`, { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId: TEST_CASE_ID }),
  });
}

let lengths: { users: number; sessions: number; access: number; messages: number; events: number; memberships: number; notifications: number; recipients: number; cases: number };
beforeEach(() => {
  idCounter = 0;
  familySession = null;
  resetRateLimiter();
  lengths = {
    users: portalUserFixtures.length,
    sessions: portalSessionFixtures.length,
    access: portalAccessFixtures.length,
    messages: portalMessageFixtures.length,
    events: activityEventFixtures.length,
    memberships: membershipFixtures.length,
    notifications: notificationFixtures.length,
    recipients: notificationRecipientFixtures.length,
    cases: caseFixtures.length,
  };
  caseFixtures.push({
    id: TEST_CASE_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-999',
    decedentName: 'Test Decedent',
    dateOfBirth: '01/01/1950',
    dateOfDeath: '01/01/2026',
    timeOfDeath: '',
    placeOfDeath: '',
    weight: '',
    rawStage: 0,
    assignedStaffId: null,
    nextOfKinName: '',
    nextOfKinPhone: '',
    paymentStatus: 'awaiting_payment',
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
    checklistState: {},
    fieldValues: {},
    daysWaitingInStage: 0,
    isStalled: false,
    stalledReason: null,
    createdBy: null,
    intakeOwnerId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    isDeleted: false,
    workflowTemplateId: 'wf-1',
    workflowTemplateVersion: 1,
    caseType: 'cremation',
    workflowSnapshot: null,
  });
});
afterEach(() => {
  portalUserFixtures.length = lengths.users;
  portalSessionFixtures.length = lengths.sessions;
  portalAccessFixtures.length = lengths.access;
  portalMessageFixtures.length = lengths.messages;
  activityEventFixtures.length = lengths.events;
  membershipFixtures.length = lengths.memberships;
  notificationFixtures.length = lengths.notifications;
  notificationRecipientFixtures.length = lengths.recipients;
  caseFixtures.length = lengths.cases;
});

async function seedAuthorizedSession() {
  const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
  const { createPortalSession } = await import('@/services/portal/portalSessionService');
  const { portalUser } = await findOrCreatePortalUser(
    { email: 'family-messages@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
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
  return portalUser;
}

describe('GET /api/family/cases/[caseId]/messages', () => {
  it('returns 401 with no family session', async () => {
    expect((await listRequest()).status).toBe(401);
  });

  it('lists messages for the case', async () => {
    await seedAuthorizedSession();
    await sendRequest({ body: 'When is the service?' });

    const response = await listRequest();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].body).toBe('When is the service?');
  });
});

describe('POST /api/family/cases/[caseId]/messages', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    expect((await sendRequest({ body: 'x' }, { origin: 'http://evil.test', host: 'localhost' })).status).toBe(403);
  });

  it('returns 401 with no family session', async () => {
    expect((await sendRequest({ body: 'x' })).status).toBe(401);
  });

  it('rejects an empty body', async () => {
    await seedAuthorizedSession();
    expect((await sendRequest({ body: '   ' })).status).toBe(400);
  });

  it('sends a family message, records portal.message.sent, and notifies staff by role', async () => {
    membershipFixtures.push({
      id: 'membership-family-msg-test',
      identityId: 'fd-recipient-msg-test',
      organizationId: DEFAULT_ORGANIZATION_ID,
      role: 'funeralDirector',
      status: 'active',
      invitedBy: null,
      joinedAt: '2026-08-01T00:00:00.000Z',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    await seedAuthorizedSession();

    const response = await sendRequest({ body: 'Thank you for your help.' });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.message.senderType).toBe('family');
    expect(activityEventFixtures.some((e) => e.eventType === 'portal.message.sent')).toBe(true);

    const notification = notificationFixtures.find((n) => n.notificationType === 'portal.staff_message_received');
    expect(notification).toBeDefined();
    const recipient = notificationRecipientFixtures.find((r) => r.notificationId === notification!.id);
    expect(recipient?.identityId).toBe('fd-recipient-msg-test');
  });

  it('rate-limits repeated sends per (portalUserId, caseId)', async () => {
    await seedAuthorizedSession();
    for (let i = 0; i < 20; i += 1) {
      await sendRequest({ body: `message ${i}` });
    }
    const response = await sendRequest({ body: 'one too many' });
    expect(response.status).toBe(429);
  });
});
