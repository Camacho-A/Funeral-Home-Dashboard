import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalUserFixtures, portalSessionFixtures, portalAccessFixtures } from '@/services/__mocks__/portalFixtures';
import { notificationFixtures, notificationRecipientFixtures, notificationDeliveryFixtures } from '@/services/__mocks__/notificationFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { hashPassword } from '@/lib/identity/passwordHashing';

let familySession: { portalUserId: string; sessionId: string; aud: 'family'; issuedAt: number; expiresAt: number } | null = null;
vi.mock('@/lib/auth/familySession', () => ({
  getFamilySession: async () => familySession,
  clearFamilySession: async () => undefined,
}));

const { PATCH } = await import('./route');

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `family-notif-recipient-route-test-${idCounter}`;
}

function patchRequest(recipientId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request(`http://localhost/api/family/notifications/recipients/${recipientId}`, { method: 'PATCH', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ notificationRecipientId: recipientId }),
  });
}

let lengths: { users: number; sessions: number; access: number; notifications: number; recipients: number; deliveries: number; events: number };
beforeEach(() => {
  idCounter = 0;
  familySession = null;
  lengths = {
    users: portalUserFixtures.length,
    sessions: portalSessionFixtures.length,
    access: portalAccessFixtures.length,
    notifications: notificationFixtures.length,
    recipients: notificationRecipientFixtures.length,
    deliveries: notificationDeliveryFixtures.length,
    events: activityEventFixtures.length,
  };
});
afterEach(() => {
  portalUserFixtures.length = lengths.users;
  portalSessionFixtures.length = lengths.sessions;
  portalAccessFixtures.length = lengths.access;
  notificationFixtures.length = lengths.notifications;
  notificationRecipientFixtures.length = lengths.recipients;
  notificationDeliveryFixtures.length = lengths.deliveries;
  activityEventFixtures.length = lengths.events;
});

describe('PATCH /api/family/notifications/recipients/[notificationRecipientId]', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    expect((await patchRequest('r1', { action: 'read' }, { origin: 'http://evil.test', host: 'localhost' })).status).toBe(403);
  });

  it('returns 401 with no family session', async () => {
    expect((await patchRequest('r1', { action: 'read' })).status).toBe(401);
  });

  it('rejects an invalid action', async () => {
    const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
    const { createPortalSession } = await import('@/services/portal/portalSessionService');
    const { portalUser } = await findOrCreatePortalUser(
      { email: 'family-recipient-invalid@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );
    const session = await createPortalSession({ portalUserId: portalUser.id, deviceId: 'device-1', idFactory }, 'mock');
    familySession = { portalUserId: portalUser.id, sessionId: session.id, aud: 'family', issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };

    expect((await patchRequest('r1', { action: 'delete' })).status).toBe(400);
  });

  it('marks the caller\'s own notification read', async () => {
    const { findOrCreatePortalUser } = await import('@/services/portal/portalUserService');
    const { createPortalSession } = await import('@/services/portal/portalSessionService');
    const { createNotification } = await import('@/services/notificationService');
    const { portalUser } = await findOrCreatePortalUser(
      { email: 'family-recipient-mark-read@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );
    const session = await createPortalSession({ portalUserId: portalUser.id, deviceId: 'device-1', idFactory }, 'mock');
    familySession = { portalUserId: portalUser.id, sessionId: session.id, aud: 'family', issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };
    portalAccessFixtures.push({
      id: 'access-1',
      portalUserId: portalUser.id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: 'case-1',
      relationshipType: 'primary_next_of_kin',
      status: 'active',
      grantedFromInvitationId: 'invitation-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    await createNotification(
      { notificationType: 'family.document_ready', recipientScope: 'portal_user', recipientPortalUserId: portalUser.id, idFactory: () => idFactory(), tokens: { entityTitle: 'x' } },
      { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'staff-1', actorMembershipId: null, actorRoleKey: 'funeralDirector', correlationId: 'corr-1' },
      'mock',
    );
    const recipient = notificationRecipientFixtures.find((r) => r.identityId === portalUser.id)!;

    const response = await patchRequest(recipient.id, { action: 'read' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recipient.readAt).not.toBeNull();
  });
});
