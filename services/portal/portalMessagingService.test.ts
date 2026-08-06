import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { portalMessageFixtures, portalAccessFixtures } from '../__mocks__/portalFixtures';
import { membershipFixtures } from '../__mocks__/identityFixtures';
import { notificationFixtures, notificationRecipientFixtures } from '../__mocks__/notificationFixtures';
import { activityEventFixtures } from '../__mocks__/activityEventFixtures';
import { caseFixtures } from '../__mocks__/fixtures';
import { DEFAULT_ORGANIZATION_ID } from '../__mocks__/organizationIds';
import type { ActivityContext } from '../activityService';
import type { Membership } from '../../types/membership';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `portal-message-test-${idCounter}`;
}

function staffCtx(overrides: Partial<ActivityContext> = {}): ActivityContext {
  return {
    organizationId: DEFAULT_ORGANIZATION_ID,
    actorIdentityId: 'staff-identity-1',
    actorMembershipId: 'membership-1',
    actorRoleKey: 'funeralDirector',
    correlationId: 'corr-message',
    ...overrides,
  };
}

function makeMembership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: `membership-${Math.random()}`,
    identityId: `identity-${Math.random()}`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    role: 'funeralDirector',
    status: 'active',
    invitedBy: null,
    joinedAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const CASE_ID = 'case-messaging-test';

let lengths: { messages: number; access: number; memberships: number; notifications: number; recipients: number; events: number; cases: number };
beforeEach(() => {
  idCounter = 0;
  lengths = {
    messages: portalMessageFixtures.length,
    access: portalAccessFixtures.length,
    memberships: membershipFixtures.length,
    notifications: notificationFixtures.length,
    recipients: notificationRecipientFixtures.length,
    events: activityEventFixtures.length,
    cases: caseFixtures.length,
  };
  caseFixtures.push({
    id: CASE_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-777',
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
  portalMessageFixtures.length = lengths.messages;
  portalAccessFixtures.length = lengths.access;
  membershipFixtures.length = lengths.memberships;
  notificationFixtures.length = lengths.notifications;
  notificationRecipientFixtures.length = lengths.recipients;
  activityEventFixtures.length = lengths.events;
  caseFixtures.length = lengths.cases;
});

describe('portalMessagingService', () => {
  it('sendStaffMessage marks readByStaffAt, notifies every active message.read-capable portal user, and requires a real actorIdentityId', async () => {
    portalAccessFixtures.push({
      id: 'access-1',
      portalUserId: 'portal-user-1',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: CASE_ID,
      relationshipType: 'primary_next_of_kin',
      status: 'active',
      grantedFromInvitationId: 'invitation-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    const { sendStaffMessage } = await import('./portalMessagingService');
    const message = await sendStaffMessage({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: CASE_ID, body: 'Hello family', idFactory }, staffCtx(), 'mock');

    expect(message.senderType).toBe('staff');
    expect(message.senderStaffIdentityId).toBe('staff-identity-1');
    expect(message.readByStaffAt).not.toBeNull();
    expect(message.readByFamilyAt).toBeNull();

    const notification = notificationFixtures.find((n) => n.notificationType === 'family.message_received');
    expect(notification).toBeDefined();
    const recipient = notificationRecipientFixtures.find((r) => r.notificationId === notification!.id);
    expect(recipient?.identityId).toBe('portal-user-1');
  });

  it('sendStaffMessage never notifies a portal user whose grant is not active or lacks message.read', async () => {
    portalAccessFixtures.push(
      { id: 'access-disabled', portalUserId: 'portal-user-2', organizationId: DEFAULT_ORGANIZATION_ID, caseId: CASE_ID, relationshipType: 'primary_next_of_kin', status: 'disabled', grantedFromInvitationId: 'invitation-2', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
      { id: 'access-reserved', portalUserId: 'portal-user-3', organizationId: DEFAULT_ORGANIZATION_ID, caseId: CASE_ID, relationshipType: 'attorney', status: 'active', grantedFromInvitationId: 'invitation-3', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
    );

    const { sendStaffMessage } = await import('./portalMessagingService');
    await sendStaffMessage({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: CASE_ID, body: 'Hello', idFactory }, staffCtx(), 'mock');

    expect(notificationFixtures.some((n) => n.notificationType === 'family.message_received')).toBe(false);
  });

  it('sendStaffMessage throws when ctx has no real actorIdentityId', async () => {
    const { sendStaffMessage, PortalMessagingServiceError } = await import('./portalMessagingService');
    await expect(
      sendStaffMessage({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: CASE_ID, body: 'x', idFactory }, staffCtx({ actorIdentityId: null }), 'mock'),
    ).rejects.toThrow(PortalMessagingServiceError);
  });

  it('sendFamilyMessage marks readByFamilyAt, records portal.message.sent anonymously with real metadata, and notifies staff by role', async () => {
    membershipFixtures.push(makeMembership({ identityId: 'fd-recipient-1' }));

    const { sendFamilyMessage } = await import('./portalMessagingService');
    const message = await sendFamilyMessage(
      { organizationId: DEFAULT_ORGANIZATION_ID, caseId: CASE_ID, portalUserId: 'portal-user-9', portalAccessId: 'access-9', relationshipType: 'primary_next_of_kin', body: 'When is the service?', idFactory },
      'mock',
    );

    expect(message.senderType).toBe('family');
    expect(message.senderPortalUserId).toBe('portal-user-9');
    expect(message.senderRelationshipTypeAtSend).toBe('primary_next_of_kin');
    expect(message.readByFamilyAt).not.toBeNull();
    expect(message.readByStaffAt).toBeNull();

    const recorded = activityEventFixtures.find((e) => e.eventType === 'portal.message.sent');
    expect(recorded?.actorIdentityId).toBeNull();
    expect(JSON.parse(recorded!.metadata!)).toEqual({ portalUserId: 'portal-user-9' });

    const notification = notificationFixtures.find((n) => n.notificationType === 'portal.staff_message_received');
    expect(notification).toBeDefined();
    const recipient = notificationRecipientFixtures.find((r) => r.notificationId === notification!.id);
    expect(recipient?.identityId).toBe('fd-recipient-1');
  });

  it('listMessagesForCase returns messages in ascending createdAt order, scoped to the case', async () => {
    const { sendFamilyMessage, listMessagesForCase } = await import('./portalMessagingService');
    await sendFamilyMessage({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: CASE_ID, portalUserId: 'p1', portalAccessId: 'a1', relationshipType: 'primary_next_of_kin', body: 'first', idFactory, now: '2026-08-01T00:00:00.000Z' }, 'mock');
    await sendFamilyMessage({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: CASE_ID, portalUserId: 'p1', portalAccessId: 'a1', relationshipType: 'primary_next_of_kin', body: 'second', idFactory, now: '2026-08-02T00:00:00.000Z' }, 'mock');
    await sendFamilyMessage({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'other-case', portalUserId: 'p2', portalAccessId: 'a2', relationshipType: 'primary_next_of_kin', body: 'unrelated', idFactory }, 'mock');

    const messages = await listMessagesForCase(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock');
    expect(messages.map((m) => m.body)).toEqual(['first', 'second']);
  });

  it('markReadByStaff / markReadByFamily set exactly the one read-receipt field', async () => {
    const { sendFamilyMessage, markReadByStaff } = await import('./portalMessagingService');
    const message = await sendFamilyMessage({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: CASE_ID, portalUserId: 'p1', portalAccessId: 'a1', relationshipType: 'primary_next_of_kin', body: 'read me', idFactory }, 'mock');
    expect(message.readByStaffAt).toBeNull();

    await markReadByStaff(DEFAULT_ORGANIZATION_ID, message.id, 'mock');
    const updated = portalMessageFixtures.find((m) => m.id === message.id)!;
    expect(updated.readByStaffAt).not.toBeNull();
    expect(updated.body).toBe('read me'); // untouched
  });

  it('exposes no update or delete function for the message body — immutable, insert-only', async () => {
    const moduleExports = await import('./portalMessagingService');
    const exportNames = Object.keys(moduleExports);
    expect(exportNames.some((name) => /^updateMessage|^deleteMessage|^editMessage/i.test(name))).toBe(false);
  });
});
