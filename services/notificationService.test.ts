import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNotification,
  cancelNotification,
  markRead,
  archiveNotificationForRecipient,
  listForRecipient,
  listForOrganization,
  getUnreadCount,
  getNotification,
  getPreferences,
  updatePreferences,
  NotificationServiceError,
  markAllReadForIdentity,
  notificationRecipientId,
  notificationDeliveryId,
  notificationDeliveryAttemptId,
} from './notificationService';
import {
  notificationFixtures,
  notificationRecipientFixtures,
  notificationDeliveryFixtures,
  notificationDeliveryAttemptFixtures,
  notificationPreferenceFixtures,
} from './__mocks__/notificationFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { membershipFixtures, identityFixtures, MANORS_ADMIN_IDENTITY_ID, MANORS_CHRIS_IDENTITY_ID } from './__mocks__/identityFixtures';
import { portalUserFixtures } from './__mocks__/portalFixtures';
import { caseFixtures } from './__mocks__/fixtures';
import type { Case } from '../types/case';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { ActivityContext } from './activityService';
import type { Membership } from '../types/membership';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `notif-id-${idCounter}`;
}

function ctx(overrides: Partial<ActivityContext> = {}): ActivityContext {
  return {
    organizationId: DEFAULT_ORGANIZATION_ID,
    actorIdentityId: 'identity-actor',
    actorMembershipId: 'membership-actor',
    actorRoleKey: 'manager',
    correlationId: 'corr-1',
    ...overrides,
  };
}

function makeMembership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: `membership-${Math.random()}`,
    identityId: `identity-${Math.random()}`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    role: 'officeStaff',
    status: 'active',
    invitedBy: null,
    joinedAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Phase 33 (Real Notification Delivery) test helper: replaces the
    fixture array *slot* with a new object rather than mutating the
    existing one in place — `originalIdentityFixtures` (below) is only a
    shallow copy of the array, so mutating a fixture object directly
    would permanently corrupt every subsequent test's "reset" state. */
function setIdentityPhone(identityId: string, phone: string | null) {
  const index = identityFixtures.findIndex((i) => i.id === identityId);
  identityFixtures[index] = { ...identityFixtures[index], phone };
}

const originalMembershipFixtures = [...membershipFixtures];
const originalIdentityFixtures = [...identityFixtures];

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  idCounter = 0;
  notificationFixtures.length = 0;
  notificationRecipientFixtures.length = 0;
  notificationDeliveryFixtures.length = 0;
  notificationDeliveryAttemptFixtures.length = 0;
  notificationPreferenceFixtures.length = 0;
  activityEventFixtures.length = 0;
  membershipFixtures.length = 0;
  membershipFixtures.push(...originalMembershipFixtures);
  identityFixtures.length = 0;
  identityFixtures.push(...originalIdentityFixtures);
  portalUserFixtures.length = 0;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  notificationFixtures.length = 0;
  notificationRecipientFixtures.length = 0;
  notificationDeliveryFixtures.length = 0;
  notificationDeliveryAttemptFixtures.length = 0;
  notificationPreferenceFixtures.length = 0;
  activityEventFixtures.length = 0;
  membershipFixtures.length = 0;
  membershipFixtures.push(...originalMembershipFixtures);
  identityFixtures.length = 0;
  identityFixtures.push(...originalIdentityFixtures);
  portalUserFixtures.length = 0;
  logSpy.mockRestore();
});

describe('createNotification', () => {
  it('a saveAsDraft notification stays draft — no recipients, no deliveries, no recipient resolution at all', async () => {
    const notification = await createNotification(
      { notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, saveAsDraft: true, idFactory, tokens: {} },
      ctx(),
      'mock',
    );
    expect(notification.status).toBe('draft');
    expect(notificationRecipientFixtures).toHaveLength(0);
    expect(notificationDeliveryFixtures).toHaveLength(0);
    expect(activityEventFixtures.some((e) => e.eventType === 'notification.created')).toBe(true);
    expect(activityEventFixtures.some((e) => e.eventType === 'notification.sent')).toBe(false);
  });

  it('individual scope: creates one recipient + one delivery per enabled channel; Notification reaches active independent of any Delivery outcome', async () => {
    const notification = await createNotification(
      {
        notificationType: 'task.assigned',
        recipientScope: 'individual',
        recipientIdentityId: MANORS_ADMIN_IDENTITY_ID,
        idFactory,
        tokens: { actorDisplayName: 'Dana', entityTitle: 'Call the cemetery' },
      },
      ctx(),
      'mock',
    );

    expect(notification.status).toBe('active');
    expect(notification.title).toBe('Task assigned');
    expect(notification.body).toBe('Dana assigned you: "Call the cemetery"');

    expect(notificationRecipientFixtures).toHaveLength(1);
    const recipient = notificationRecipientFixtures[0];
    expect(recipient.identityId).toBe(MANORS_ADMIN_IDENTITY_ID);
    expect(recipient.readAt).toBeNull();
    expect(recipient.archivedAt).toBeNull();

    // both channels enabled by default (missing preference row)
    expect(notificationDeliveryFixtures).toHaveLength(2);
    const inApp = notificationDeliveryFixtures.find((d) => d.channel === 'in_app');
    const email = notificationDeliveryFixtures.find((d) => d.channel === 'email');
    expect(inApp?.status).toBe('delivered');
    expect(email?.status).toBe('sent');
    expect(notificationDeliveryAttemptFixtures).toHaveLength(2);
    expect(notificationDeliveryAttemptFixtures.every((a) => a.succeeded)).toBe(true);

    const types = activityEventFixtures.map((e) => e.eventType);
    expect(types).toContain('notification.created');
    expect(types).toContain('notification.delivered');
    expect(types).toContain('notification.sent');
    expect(types.filter((t) => t === 'notification.delivered')).toHaveLength(2);
  });

  it('role scope fans out to every active membership holding that role, at creation time only', async () => {
    membershipFixtures.push(
      makeMembership({ identityId: 'fd-1', role: 'funeralDirector', status: 'active' }),
      makeMembership({ identityId: 'fd-2', role: 'funeralDirector', status: 'active' }),
      makeMembership({ identityId: 'fd-3-disabled', role: 'funeralDirector', status: 'disabled' }),
    );
    await createNotification({ notificationType: 'system.announcement', recipientScope: 'role', recipientRoleKey: 'funeralDirector', idFactory, tokens: { entityTitle: 'Heads up' } }, ctx(), 'mock');
    expect(notificationRecipientFixtures.map((r) => r.identityId).sort()).toEqual(['fd-1', 'fd-2']);

    // a membership added afterward never retroactively appears on the earlier notification
    membershipFixtures.push(makeMembership({ identityId: 'fd-4-late', role: 'funeralDirector', status: 'active' }));
    expect(notificationRecipientFixtures.map((r) => r.identityId)).not.toContain('fd-4-late');
  });

  it('organization_wide scope fans out to every active membership in the organization', async () => {
    membershipFixtures.push(makeMembership({ identityId: 'staff-a' }), makeMembership({ identityId: 'staff-b' }));
    await createNotification({ notificationType: 'system.announcement', recipientScope: 'organization_wide', idFactory, tokens: { entityTitle: 'All hands' } }, ctx(), 'mock');
    const ids = notificationRecipientFixtures.map((r) => r.identityId).sort();
    expect(ids).toContain('staff-a');
    expect(ids).toContain('staff-b');
  });

  it('Phase 30: case_participants scope resolves real recipients from Case.assignedStaffId/intakeOwnerId, via StaffProfile', async () => {
    const testCase: Case = {
      id: 'case-notif-participants-test',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseNumber: 'B2026-777',
      decedentName: 'Test Decedent',
      dateOfBirth: '01/01/1950',
      dateOfDeath: '01/01/2026',
      timeOfDeath: '',
      placeOfDeath: '',
      weight: '',
      rawStage: 0,
      assignedStaffId: 'staff-dana',
      nextOfKinName: 'Test NOK',
      nextOfKinPhone: '555-0000',
      nextOfKinEmail: null,
      nextOfKinRelationship: null,
      nextOfKinRelationshipOther: null,
      certifierName: null,
      certifierPhone: null,
      certifierLicenseNumber: null,
      certifierFax: null,
      tagNumber: null,
      paymentStatus: 'awaiting_payment',
      isVeteran: false,
      vaStepsState: {},
      vaPublishChoice: null,
    vaNotificationResponsibility: null,
      checklistState: {},
      fieldValues: {},
      pickupStatus: 'awaiting_pickup',
      pickupReleasedTo: null,
      pickupReleasedAt: null,
      pickupNote: null,
      returnMethod: 'undecided',
      shippingCarrier: null,
      shippingTrackingNumber: null,
      shippingDateShipped: null,
      shippingDeliveryStatus: null,
      shippingDeliveredAt: null,
      daysWaitingInStage: 0,
      isStalled: false,
      stalledReason: null,
      createdBy: null,
      intakeOwnerId: 'staff-chris',
      createdAt: '2026-01-01T00:00:00.000Z',
      isDeleted: false,
      workflowTemplateId: 'wf-1',
      workflowTemplateVersion: 1,
      caseType: 'cremation',
      workflowSnapshot: null,
    };
    caseFixtures.push(testCase);
    try {
      await createNotification(
        { notificationType: 'case.created', recipientScope: 'case_participants', caseId: testCase.id, idFactory, tokens: { entityTitle: 'Test Decedent' } },
        ctx(),
        'mock',
      );
      const ids = notificationRecipientFixtures.map((r) => r.identityId).sort();
      expect(ids).toEqual([MANORS_ADMIN_IDENTITY_ID, MANORS_CHRIS_IDENTITY_ID].sort());
    } finally {
      caseFixtures.length = caseFixtures.findIndex((c) => c.id === testCase.id);
    }
  });

  it('case_participants scope with an unresolvable case yields zero recipients, not an error', async () => {
    await createNotification(
      { notificationType: 'case.created', recipientScope: 'case_participants', caseId: 'case-does-not-exist', idFactory, tokens: {} },
      ctx(),
      'mock',
    );
    expect(notificationRecipientFixtures).toHaveLength(0);
  });

  it('Phase 29: portal_user scope resolves email via getPortalUserById once getIdentityById returns null for that id', async () => {
    portalUserFixtures.push({
      id: 'portal-user-notif-1',
      email: 'family@example.com',
      normalizedEmail: 'family@example.com',
      displayName: 'Pat Family',
      passwordHash: 'salt:derived',
      emailVerified: false,
      status: 'active',
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    const notification = await createNotification(
      { notificationType: 'family.document_ready', recipientScope: 'portal_user', recipientPortalUserId: 'portal-user-notif-1', idFactory, tokens: { entityTitle: 'Cremation Authorization' } },
      ctx(),
      'mock',
    );

    expect(notification.status).toBe('active');
    expect(notificationRecipientFixtures).toHaveLength(1);
    expect(notificationRecipientFixtures[0].identityId).toBe('portal-user-notif-1');

    const email = notificationDeliveryFixtures.find((d) => d.channel === 'email');
    expect(email?.status).toBe('sent');
    const inApp = notificationDeliveryFixtures.find((d) => d.channel === 'in_app');
    expect(inApp?.status).toBe('delivered');
  });

  it('Phase 29: portal_user scope with an unresolvable id fails the email delivery without blocking in-app delivery — matches the existing unresolvable-identity behavior exactly', async () => {
    const notification = await createNotification(
      { notificationType: 'family.document_ready', recipientScope: 'portal_user', recipientPortalUserId: 'no-such-portal-user', idFactory, tokens: {} },
      ctx(),
      'mock',
    );

    expect(notification.status).toBe('active');
    const email = notificationDeliveryFixtures.find((d) => d.channel === 'email');
    expect(email?.status).toBe('failed');
  });

  it('a disabled channel in NotificationPreference produces no Delivery row for that channel', async () => {
    await updatePreferences(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, { emailEnabled: false }, 'mock');
    await createNotification({ notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} }, ctx(), 'mock');
    expect(notificationDeliveryFixtures).toHaveLength(1);
    expect(notificationDeliveryFixtures[0].channel).toBe('in_app');
  });

  it('a failed email delivery (unresolvable identity) never blocks in-app delivery or the Notification reaching active', async () => {
    const notification = await createNotification(
      { notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: 'identity-does-not-exist', idFactory, tokens: {} },
      ctx(),
      'mock',
    );
    expect(notification.status).toBe('active');
    const inApp = notificationDeliveryFixtures.find((d) => d.channel === 'in_app');
    const email = notificationDeliveryFixtures.find((d) => d.channel === 'email');
    expect(inApp?.status).toBe('delivered');
    expect(email?.status).toBe('failed');
    expect(activityEventFixtures.some((e) => e.eventType === 'notification.failed')).toBe(true);
  });

  it('throws for an unrecognized notification type', async () => {
    await expect(createNotification({ notificationType: 'bogus.type', recipientScope: 'individual', recipientIdentityId: 'x', idFactory, tokens: {} }, ctx(), 'mock')).rejects.toThrow(
      NotificationServiceError,
    );
  });
});

describe('Phase 33 (Real Notification Delivery): SMS channel', () => {
  it('sends SMS when smsEnabled and the identity has a phone number on file', async () => {
    await updatePreferences(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, { smsEnabled: true }, 'mock');
    setIdentityPhone(MANORS_ADMIN_IDENTITY_ID, '+15555550100');

    await createNotification({ notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} }, ctx(), 'mock');

    const sms = notificationDeliveryFixtures.find((d) => d.channel === 'sms');
    expect(sms?.status).toBe('sent');
  });

  it('fails the SMS delivery (without blocking in_app/email) when smsEnabled but no phone number is on file — a real, expected empty state, never a thrown error', async () => {
    await updatePreferences(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, { smsEnabled: true }, 'mock');
    // identityFixtures default to phone: null — deliberately not set here.

    const notification = await createNotification(
      { notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} },
      ctx(),
      'mock',
    );

    expect(notification.status).toBe('active');
    const sms = notificationDeliveryFixtures.find((d) => d.channel === 'sms');
    const inApp = notificationDeliveryFixtures.find((d) => d.channel === 'in_app');
    expect(sms?.status).toBe('failed');
    expect(inApp?.status).toBe('delivered');
    expect(activityEventFixtures.some((e) => e.eventType === 'notification.failed')).toBe(true);
  });

  it('produces no sms Delivery row at all when smsEnabled is false (the default)', async () => {
    await createNotification({ notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} }, ctx(), 'mock');
    expect(notificationDeliveryFixtures.some((d) => d.channel === 'sms')).toBe(false);
  });
});

describe('Phase 33 (Real Notification Delivery): per-category overrides', () => {
  it('a category override replaces the global toggles wholesale for that category', async () => {
    // Global: email on, sms off. Override for 'task': email off, sms on.
    await updatePreferences(
      DEFAULT_ORGANIZATION_ID,
      MANORS_ADMIN_IDENTITY_ID,
      { categoryOverrides: { task: { emailEnabled: false, inAppEnabled: true, smsEnabled: true } } },
      'mock',
    );
    setIdentityPhone(MANORS_ADMIN_IDENTITY_ID, '+15555550100');

    // 'task.assigned' is category 'task' — should use the override.
    await createNotification({ notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} }, ctx(), 'mock');
    expect(notificationDeliveryFixtures.some((d) => d.channel === 'email')).toBe(false);
    expect(notificationDeliveryFixtures.some((d) => d.channel === 'sms')).toBe(true);
  });

  it('a category with no override falls back to the global toggles', async () => {
    await updatePreferences(
      DEFAULT_ORGANIZATION_ID,
      MANORS_ADMIN_IDENTITY_ID,
      { emailEnabled: false, categoryOverrides: { task: { emailEnabled: true, inAppEnabled: true, smsEnabled: false } } },
      'mock',
    );
    // 'system.announcement' is category 'system' — no override set for it, falls back to the global emailEnabled: false.
    await createNotification({ notificationType: 'system.announcement', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: { entityTitle: 'x' } }, ctx(), 'mock');
    expect(notificationDeliveryFixtures.some((d) => d.channel === 'email')).toBe(false);
  });
});

describe('Phase 33 (Real Notification Delivery): digest batching & quiet hours', () => {
  it('a non-instant digestFrequency defers the email to queued_for_digest instead of sending it', async () => {
    await updatePreferences(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, { digestFrequency: 'daily' }, 'mock');
    await createNotification({ notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} }, ctx(), 'mock');

    const email = notificationDeliveryFixtures.find((d) => d.channel === 'email');
    expect(email?.status).toBe('queued_for_digest');
    expect(email?.attemptCount).toBe(0);
    // Deliberately no attempt, no activity event — nothing has happened yet.
    expect(notificationDeliveryAttemptFixtures.some((a) => a.notificationDeliveryId === email?.id)).toBe(false);
    // in_app is never deferred by digestFrequency.
    const inApp = notificationDeliveryFixtures.find((d) => d.channel === 'in_app');
    expect(inApp?.status).toBe('delivered');
  });

  it('an instant preference inside quiet hours defers the email; outside quiet hours it sends immediately', async () => {
    await updatePreferences(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, { quietHoursStart: '22:00', quietHoursEnd: '07:00' }, 'mock');

    await createNotification(
      { notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {}, now: '2026-08-01T23:30:00.000Z' },
      ctx(),
      'mock',
    );
    const deferred = notificationDeliveryFixtures.find((d) => d.channel === 'email');
    expect(deferred?.status).toBe('queued_for_digest');

    notificationDeliveryFixtures.length = 0;
    notificationRecipientFixtures.length = 0;

    await createNotification(
      { notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {}, now: '2026-08-01T12:00:00.000Z' },
      ctx(),
      'mock',
    );
    const sent = notificationDeliveryFixtures.find((d) => d.channel === 'email');
    expect(sent?.status).toBe('sent');
  });

  it('sms is never deferred by digestFrequency or quiet hours, even when email is', async () => {
    await updatePreferences(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, { digestFrequency: 'daily', smsEnabled: true }, 'mock');
    setIdentityPhone(MANORS_ADMIN_IDENTITY_ID, '+15555550100');

    await createNotification({ notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} }, ctx(), 'mock');

    const sms = notificationDeliveryFixtures.find((d) => d.channel === 'sms');
    const email = notificationDeliveryFixtures.find((d) => d.channel === 'email');
    expect(sms?.status).toBe('sent');
    expect(email?.status).toBe('queued_for_digest');
  });
});

describe('cancelNotification', () => {
  it('cancels a draft notification', async () => {
    const notification = await createNotification(
      { notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, saveAsDraft: true, idFactory, tokens: {} },
      ctx(),
      'mock',
    );
    const cancelled = await cancelNotification(DEFAULT_ORGANIZATION_ID, notification.id, ctx(), 'mock');
    expect(cancelled.status).toBe('cancelled');
    expect(activityEventFixtures.some((e) => e.eventType === 'notification.cancelled')).toBe(true);
  });

  it('throws when the notification has already reached active', async () => {
    const notification = await createNotification(
      { notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} },
      ctx(),
      'mock',
    );
    await expect(cancelNotification(DEFAULT_ORGANIZATION_ID, notification.id, ctx(), 'mock')).rejects.toThrow(NotificationServiceError);
  });
});

describe('markRead / archiveNotificationForRecipient', () => {
  it('marks a recipient row + its in-app delivery read, and is idempotent (no duplicate activity event)', async () => {
    const notification = await createNotification(
      { notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} },
      ctx(),
      'mock',
    );
    const recipient = notificationRecipientFixtures.find((r) => r.notificationId === notification.id)!;

    const updated = await markRead(DEFAULT_ORGANIZATION_ID, recipient.id, MANORS_ADMIN_IDENTITY_ID, ctx(), 'mock');
    expect(updated.readAt).not.toBeNull();
    const inAppDelivery = notificationDeliveryFixtures.find((d) => d.notificationRecipientId === recipient.id && d.channel === 'in_app');
    expect(inAppDelivery?.status).toBe('read');
    expect(activityEventFixtures.filter((e) => e.eventType === 'notification.read')).toHaveLength(1);

    // Notification's own status is untouched by a recipient's read.
    const stillActive = await getNotification(DEFAULT_ORGANIZATION_ID, notification.id, 'mock');
    expect(stillActive?.status).toBe('active');

    await markRead(DEFAULT_ORGANIZATION_ID, recipient.id, MANORS_ADMIN_IDENTITY_ID, ctx(), 'mock');
    expect(activityEventFixtures.filter((e) => e.eventType === 'notification.read')).toHaveLength(1);
  });

  it('markRead rejects when the recipient row does not belong to the calling identity', async () => {
    const notification = await createNotification(
      { notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} },
      ctx(),
      'mock',
    );
    const recipient = notificationRecipientFixtures.find((r) => r.notificationId === notification.id)!;
    await expect(markRead(DEFAULT_ORGANIZATION_ID, recipient.id, 'someone-else', ctx(), 'mock')).rejects.toThrow(NotificationServiceError);
  });

  it('archives a recipient row and is idempotent', async () => {
    const notification = await createNotification(
      { notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} },
      ctx(),
      'mock',
    );
    const recipient = notificationRecipientFixtures.find((r) => r.notificationId === notification.id)!;
    const archived = await archiveNotificationForRecipient(DEFAULT_ORGANIZATION_ID, recipient.id, MANORS_ADMIN_IDENTITY_ID, 'mock');
    expect(archived.archivedAt).not.toBeNull();
    const archivedAgain = await archiveNotificationForRecipient(DEFAULT_ORGANIZATION_ID, recipient.id, MANORS_ADMIN_IDENTITY_ID, 'mock');
    expect(archivedAgain.archivedAt).toBe(archived.archivedAt);
  });
});

describe('read and automatic archiving (2026-10)', () => {
  async function oneNotification() {
    const notification = await createNotification(
      { notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} },
      ctx(),
      'mock',
    );
    return notificationRecipientFixtures.find((r) => r.notificationId === notification.id)!;
  }

  it('archiving an unread notification also reads it, so the unread badge drops', async () => {
    const recipient = await oneNotification();
    expect(await getUnreadCount(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, 'mock')).toBe(1);

    const archived = await archiveNotificationForRecipient(DEFAULT_ORGANIZATION_ID, recipient.id, MANORS_ADMIN_IDENTITY_ID, 'mock');

    expect(archived.archivedAt).not.toBeNull();
    expect(archived.readAt).toBe(archived.archivedAt);
    expect(await getUnreadCount(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, 'mock')).toBe(0);
  });

  it('archiving an already-read notification keeps when it was read', async () => {
    const recipient = await oneNotification();
    const read = await markRead(DEFAULT_ORGANIZATION_ID, recipient.id, MANORS_ADMIN_IDENTITY_ID, ctx(), 'mock');
    const archived = await archiveNotificationForRecipient(DEFAULT_ORGANIZATION_ID, recipient.id, MANORS_ADMIN_IDENTITY_ID, 'mock');
    expect(archived.readAt).toBe(read.readAt);
  });

  it('a notification read a week ago leaves the inbox by itself, and stays under "Show archived"', async () => {
    const recipient = await oneNotification();
    const index = notificationRecipientFixtures.findIndex((r) => r.id === recipient.id);
    notificationRecipientFixtures[index] = { ...recipient, readAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() };

    const inbox = await listForRecipient(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, {}, null, 10, 'mock');
    expect(inbox.items).toHaveLength(0);
    const withArchived = await listForRecipient(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, { includeArchived: true }, null, 10, 'mock');
    expect(withArchived.items).toHaveLength(1);
    // Nothing was written to do it.
    expect(notificationRecipientFixtures[index].archivedAt).toBeNull();
  });

  it('a notification read today, and any unread one however old, stays in the inbox', async () => {
    const recipient = await oneNotification();
    await markRead(DEFAULT_ORGANIZATION_ID, recipient.id, MANORS_ADMIN_IDENTITY_ID, ctx(), 'mock');
    const old = await oneNotification();
    const index = notificationRecipientFixtures.findIndex((r) => r.id === old.id);
    notificationRecipientFixtures[index] = { ...old, createdAt: '2025-01-01T00:00:00.000Z' };

    const inbox = await listForRecipient(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, {}, null, 10, 'mock');
    expect(inbox.items).toHaveLength(2);
  });
});

describe('preferences', () => {
  it('a missing preference row resolves to both channels enabled by default', async () => {
    const prefs = await getPreferences(DEFAULT_ORGANIZATION_ID, 'identity-with-no-row', 'mock');
    expect(prefs.emailEnabled).toBe(true);
    expect(prefs.inAppEnabled).toBe(true);
    expect(notificationPreferenceFixtures).toHaveLength(0);
  });

  it('updatePreferences creates a row on first call, patches it on subsequent calls', async () => {
    const created = await updatePreferences(DEFAULT_ORGANIZATION_ID, 'identity-x', { emailEnabled: false }, 'mock');
    expect(created.emailEnabled).toBe(false);
    expect(created.inAppEnabled).toBe(true);
    expect(notificationPreferenceFixtures).toHaveLength(1);

    const patched = await updatePreferences(DEFAULT_ORGANIZATION_ID, 'identity-x', { inAppEnabled: false }, 'mock');
    expect(patched.inAppEnabled).toBe(false);
    expect(patched.emailEnabled).toBe(false);
    expect(notificationPreferenceFixtures).toHaveLength(1);
  });
});

describe('listForRecipient', () => {
  it('lists only the calling identity notifications, newest first, respecting category/unreadOnly/includeArchived filters', async () => {
    await createNotification({ notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {}, now: '2026-08-01T00:00:00.000Z' }, ctx(), 'mock');
    await createNotification(
      { notificationType: 'system.announcement', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: { entityTitle: 'x' }, now: '2026-08-02T00:00:00.000Z' },
      ctx(),
      'mock',
    );

    const all = await listForRecipient(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, {}, null, 10, 'mock');
    expect(all.items).toHaveLength(2);
    expect(all.items[0].notification.notificationType).toBe('system.announcement'); // newest first

    const filtered = await listForRecipient(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, { category: 'task' }, null, 10, 'mock');
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0].notification.category).toBe('task');

    const recipientToArchive = notificationRecipientFixtures.find((r) => r.identityId === MANORS_ADMIN_IDENTITY_ID)!;
    await archiveNotificationForRecipient(DEFAULT_ORGANIZATION_ID, recipientToArchive.id, MANORS_ADMIN_IDENTITY_ID, 'mock');
    const withoutArchived = await listForRecipient(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, {}, null, 10, 'mock');
    expect(withoutArchived.items).toHaveLength(1);
    const withArchived = await listForRecipient(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, { includeArchived: true }, null, 10, 'mock');
    expect(withArchived.items).toHaveLength(2);
  });

  it('never crosses tenant boundaries', async () => {
    await createNotification({ notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} }, ctx(), 'mock');
    await createNotification(
      { notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} },
      ctx({ organizationId: SECOND_MOCK_ORGANIZATION_ID }),
      'mock',
    );
    const own = await listForRecipient(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, {}, null, 10, 'mock');
    expect(own.items).toHaveLength(1);
  });
});

describe('listForOrganization', () => {
  it('lists every notification in the organization as a plain projection, newest first', async () => {
    await createNotification({ notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} }, ctx(), 'mock');
    await createNotification(
      { notificationType: 'system.announcement', recipientScope: 'organization_wide', idFactory, tokens: { entityTitle: 'x' } },
      ctx(),
      'mock',
    );
    const result = await listForOrganization(DEFAULT_ORGANIZATION_ID, {}, null, 10, 'mock');
    expect(result.notifications).toHaveLength(2);
  });
});

describe('getUnreadCount', () => {
  it('counts only unread in-app deliveries for that identity, and drops to zero once read', async () => {
    const notification = await createNotification(
      { notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} },
      ctx(),
      'mock',
    );
    expect(await getUnreadCount(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, 'mock')).toBe(1);

    const recipient = notificationRecipientFixtures.find((r) => r.notificationId === notification.id)!;
    await markRead(DEFAULT_ORGANIZATION_ID, recipient.id, MANORS_ADMIN_IDENTITY_ID, ctx(), 'mock');
    expect(await getUnreadCount(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, 'mock')).toBe(0);
  });

  it('never maintains a stored counter — it is always recomputed from NotificationDelivery rows', async () => {
    expect(await getUnreadCount(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, 'mock')).toBe(0);
    await createNotification({ notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} }, ctx(), 'mock');
    await createNotification({ notificationType: 'task.assigned', recipientScope: 'individual', recipientIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory, tokens: {} }, ctx(), 'mock');
    expect(await getUnreadCount(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, 'mock')).toBe(2);
  });
});

describe('NotificationService orchestration boundary (structural)', () => {
  const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);

  function walk(dir: string, results: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath, results);
      } else if (['.ts', '.tsx'].includes(extname(fullPath)) && !fullPath.endsWith('.test.ts') && !fullPath.endsWith('.test.tsx')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const root = join(__dirname, '..');
  const allFiles = walk(root);
  const notificationServicePath = join(__dirname, 'notificationService.ts');

  it('only notificationService.ts imports the recipient resolver', () => {
    const target = join(__dirname, 'notifications', 'recipientResolver.ts');
    const importPattern = /^import .*from ['"][^'"]*notifications\/recipientResolver['"]/m;
    const offenders = allFiles.filter((filePath) => {
      if (filePath === notificationServicePath || filePath === target) return false;
      return importPattern.test(readFileSync(filePath, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('only notificationService.ts imports the email channel', () => {
    const target = join(__dirname, 'notifications', 'emailChannel.ts');
    const importPattern = /^import .*from ['"][^'"]*notifications\/emailChannel['"]/m;
    const offenders = allFiles.filter((filePath) => {
      if (filePath === notificationServicePath || filePath === target) return false;
      return importPattern.test(readFileSync(filePath, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('Phase 33: only notificationService.ts imports the sms channel', () => {
    const target = join(__dirname, 'notifications', 'smsChannel.ts');
    const importPattern = /^import .*from ['"][^'"]*notifications\/smsChannel['"]/m;
    const offenders = allFiles.filter((filePath) => {
      if (filePath === notificationServicePath || filePath === target) return false;
      return importPattern.test(readFileSync(filePath, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('only notificationService.ts imports the in-app channel', () => {
    const target = join(__dirname, 'notifications', 'inAppChannel.ts');
    const importPattern = /^import .*from ['"][^'"]*notifications\/inAppChannel['"]/m;
    const offenders = allFiles.filter((filePath) => {
      if (filePath === notificationServicePath || filePath === target) return false;
      return importPattern.test(readFileSync(filePath, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('only notificationService.ts imports the recordNotification* activity helpers', () => {
    const helpers = ['recordNotificationCreated', 'recordNotificationSent', 'recordNotificationDelivered', 'recordNotificationRead', 'recordNotificationFailed', 'recordNotificationCancelled'];
    const importPattern = new RegExp(`^import\\s*\\{[^}]*\\b(${helpers.join('|')})\\b`, 'm');
    const offenders = allFiles.filter((filePath) => {
      if (filePath === notificationServicePath) return false;
      return importPattern.test(readFileSync(filePath, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('Phase 33: only notificationDigestService.ts calls the org-agnostic listAllQueuedForDigestDeliveries query', () => {
    const target = join(root, 'services', 'notificationDigestService.ts');
    const importPattern = /\blistAllQueuedForDigestDeliveries\b/;
    const offenders = allFiles.filter((filePath) => {
      if (filePath === notificationServicePath || filePath === target) return false;
      return importPattern.test(readFileSync(filePath, 'utf8'));
    });
    expect(offenders, `unexpected caller(s) of the org-agnostic digest query: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no file other than notificationService.ts writes to the 5 notification collections directly', () => {
    const collections = ['notifications', 'notificationRecipients', 'notificationDeliveries', 'notificationDeliveryAttempts', 'notificationPreferences'];
    for (const collection of collections) {
      const writePattern = new RegExp(`(?:insertWixDataItem|updateWixDataItem)(?:<[^>]*>)?\\(\\s*['"]${collection}['"]`);
      const offenders = allFiles.filter((filePath) => filePath !== notificationServicePath && writePattern.test(readFileSync(filePath, 'utf8')));
      expect(offenders, `unexpected writer(s) of "${collection}": ${offenders.join(', ')}`).toEqual([]);
    }
  });
});

/**
 * In-app activation safety (2026-10). `channels` is an upper bound the
 * CALLER sets. Without it, a trigger wired today would send real email —
 * every production preference row has email on with instant digest.
 */
describe('caller-supplied channel bound', () => {
  function prefs(identityId: string, over: Partial<{ emailEnabled: boolean; inAppEnabled: boolean; smsEnabled: boolean }> = {}) {
    notificationPreferenceFixtures.push({
      id: `${DEFAULT_ORGANIZATION_ID}-${identityId}`,
      organizationId: DEFAULT_ORGANIZATION_ID,
      identityId,
      emailEnabled: true,
      inAppEnabled: true,
      smsEnabled: true,
      digestFrequency: 'instant',
      quietHoursStart: null,
      quietHoursEnd: null,
      categoryOverrides: {},
    typeOverrides: {},
      lastDigestSentAt: null,
      updatedAt: '2026-10-01T00:00:00.000Z',
      ...over,
    });
  }

  it('restricts delivery to in_app when asked, despite email and sms being enabled', async () => {
    prefs(MANORS_ADMIN_IDENTITY_ID);
    await createNotification(
      {
        notificationType: 'system.announcement',
        recipientScope: 'individual',
        recipientIdentityId: MANORS_ADMIN_IDENTITY_ID,
        channels: ['in_app'],
        tokens: { entityTitle: 'Bounded' },
        idFactory,
      },
      ctx(),
      'mock',
    );
    expect(notificationDeliveryFixtures.map((d) => d.channel)).toEqual(['in_app']);
  });

  it('omitting it keeps the original behaviour — every enabled channel is used', async () => {
    prefs(MANORS_ADMIN_IDENTITY_ID);
    await createNotification(
      {
        notificationType: 'system.announcement',
        recipientScope: 'individual',
        recipientIdentityId: MANORS_ADMIN_IDENTITY_ID,
        tokens: { entityTitle: 'Unbounded' },
        idFactory,
      },
      ctx(),
      'mock',
    );
    expect(notificationDeliveryFixtures.map((d) => d.channel)).toContain('email');
  });

  it('can only NARROW — a disabled channel is never re-enabled by asking for it', async () => {
    prefs(MANORS_ADMIN_IDENTITY_ID, { emailEnabled: false, inAppEnabled: false, smsEnabled: false });
    await createNotification(
      {
        notificationType: 'system.announcement',
        recipientScope: 'individual',
        recipientIdentityId: MANORS_ADMIN_IDENTITY_ID,
        channels: ['in_app', 'email', 'sms'],
        tokens: { entityTitle: 'Still nothing' },
        idFactory,
      },
      ctx(),
      'mock',
    );
    expect(notificationDeliveryFixtures).toHaveLength(0);
  });
});

describe('markAllReadForIdentity', () => {
  async function seedUnread(count: number, identityId: string) {
    for (let i = 0; i < count; i++) {
      await createNotification(
        {
          notificationType: 'system.announcement',
          recipientScope: 'individual',
          recipientIdentityId: identityId,
          channels: ['in_app'],
          tokens: { entityTitle: `n${i}` },
          idFactory,
        },
        ctx(),
        'mock',
      );
    }
  }

  it('marks every unread row read, including past any page-size ceiling', async () => {
    // 300 > the old 250-row window, which is the point.
    await seedUnread(300, MANORS_ADMIN_IDENTITY_ID);
    expect(await getUnreadCount(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, 'mock')).toBe(300);

    const result = await markAllReadForIdentity(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, ctx(), 'mock');

    expect(result.markedRead).toBe(300);
    expect(await getUnreadCount(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, 'mock')).toBe(0);
  });

  it('touches nobody else’s inbox', async () => {
    await seedUnread(3, MANORS_ADMIN_IDENTITY_ID);
    await seedUnread(2, MANORS_CHRIS_IDENTITY_ID);

    await markAllReadForIdentity(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, ctx(), 'mock');

    expect(await getUnreadCount(DEFAULT_ORGANIZATION_ID, MANORS_CHRIS_IDENTITY_ID, 'mock')).toBe(2);
  });

  it('is a no-op when nothing is unread', async () => {
    const result = await markAllReadForIdentity(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, ctx(), 'mock');
    expect(result.markedRead).toBe(0);
  });
});

describe('unread count is exact beyond the old 250-row window', () => {
  it('counts 400 unread as 400, not 250', async () => {
    for (let i = 0; i < 400; i++) {
      await createNotification(
        {
          notificationType: 'system.announcement',
          recipientScope: 'individual',
          recipientIdentityId: MANORS_ADMIN_IDENTITY_ID,
          channels: ['in_app'],
          tokens: { entityTitle: `n${i}` },
          idFactory,
        },
        ctx(),
        'mock',
      );
    }
    expect(await getUnreadCount(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, 'mock')).toBe(400);
  });
});

/**
 * Wix _id cap (2026-10). Wix rejects any item id over 128 characters. A
 * recipient's id was `{notificationId}-{identityId}`, so every notification
 * with a long id (intake ones are 100 characters) failed to store its
 * recipient: the notification stayed `queued` and nobody ever saw it. Live
 * production had exactly that — 3 notifications, 0 recipient rows.
 */
describe('notification row ids stay within the Wix 128-character limit', () => {
  const IDENTITY = '0f5a8f0e-6b1c-4c37-9a51-2f6a0c9b7d11';
  const INTAKE_SHAPED_ID = 'intake-attention-managed-cremations-jotform-6679876908714870727-5e0b2c11-8d0a-4f5e-9a3b-7c1d2e3f4a5b';

  it('keeps the readable natural id when it fits', () => {
    expect(notificationRecipientId('notification-1', IDENTITY)).toBe(`notification-1-${IDENTITY}`);
  });

  it('bounds a long id deterministically, uniquely per recipient, leaving room for the channel suffix', () => {
    expect(INTAKE_SHAPED_ID.length).toBe(100);
    const a = notificationRecipientId(INTAKE_SHAPED_ID, IDENTITY);
    expect(a).toBe(notificationRecipientId(INTAKE_SHAPED_ID, IDENTITY));
    expect(a).not.toBe(notificationRecipientId(INTAKE_SHAPED_ID, '1f5a8f0e-6b1c-4c37-9a51-2f6a0c9b7d11'));
    expect(notificationDeliveryId(a, 'in_app').length).toBeLessThanOrEqual(128);
    expect(notificationDeliveryId(a, 'email').length).toBeLessThanOrEqual(128);
  });

  it('keeps an existing id that fits, so rows already stored keep their ids', () => {
    // Live 2026-10-20: case.completed recipient rows were stored with
    // 125-character natural ids. A retry must compute those same ids.
    const notificationId = 'n'.repeat(125 - 1 - IDENTITY.length);
    expect(notificationRecipientId(notificationId, IDENTITY)).toBe(`${notificationId}-${IDENTITY}`);
  });

  it('bounds the delivery and attempt ids built on a recipient id that only just fits', () => {
    // That same live case: its delivery id `{125}-in_app` was 132
    // characters, so the delivery insert failed and nothing was shown.
    const recipientId = 'r'.repeat(125);
    const deliveryId = notificationDeliveryId(recipientId, 'in_app');
    expect(deliveryId.length).toBeLessThanOrEqual(128);
    expect(deliveryId).toBe(notificationDeliveryId(recipientId, 'in_app'));
    expect(deliveryId).not.toBe(notificationDeliveryId(recipientId, 'email'));
    expect(notificationDeliveryAttemptId(deliveryId, 1).length).toBeLessThanOrEqual(128);
    expect(notificationDeliveryAttemptId('short', 1)).toBe('short-attempt-1');
  });

  it('a notification with a 100-character id now reaches its recipient and becomes active', async () => {
    const notification = await createNotification(
      {
        notificationType: 'task.assigned',
        recipientScope: 'individual',
        recipientIdentityId: MANORS_ADMIN_IDENTITY_ID,
        idFactory: () => INTAKE_SHAPED_ID,
        tokens: { actorDisplayName: 'Dana', entityTitle: 'Call the cemetery' },
      },
      ctx(),
      'mock',
    );

    expect(notification.status).toBe('active');
    expect(notificationRecipientFixtures).toHaveLength(1);
    expectEveryRowIdWithinWixLimit();
  });

  it('a notification whose recipient id is 125 characters reaches its recipient, with every row within the limit', async () => {
    const notificationId = 'case.completed-'.padEnd(125 - 1 - MANORS_ADMIN_IDENTITY_ID.length, 'x');
    const notification = await createNotification(
      {
        notificationType: 'task.assigned',
        recipientScope: 'individual',
        recipientIdentityId: MANORS_ADMIN_IDENTITY_ID,
        idFactory: () => notificationId,
        tokens: { actorDisplayName: 'Dana', entityTitle: 'Call the cemetery' },
      },
      ctx(),
      'mock',
    );

    expect(notification.status).toBe('active');
    expect(notificationRecipientFixtures[0].id).toBe(`${notificationId}-${MANORS_ADMIN_IDENTITY_ID}`);
    expect(notificationDeliveryFixtures.length).toBeGreaterThan(0);
    expectEveryRowIdWithinWixLimit();
  });

  /** The mock store does not enforce Wix's cap, so the rows are checked here. */
  function expectEveryRowIdWithinWixLimit() {
    for (const rows of [notificationFixtures, notificationRecipientFixtures, notificationDeliveryFixtures, notificationDeliveryAttemptFixtures]) {
      for (const row of rows) expect(row.id.length, row.id).toBeLessThanOrEqual(128);
    }
  }
});

describe('notification ids themselves stay within the Wix 128-character limit', () => {
  it('a case or intake notification id that would overrun is bounded; one that fits is unchanged', async () => {
    const { caseNotificationId } = await import('./caseNotifications');
    const { intakeNotificationId } = await import('./intakeNotifications');
    const identity = '0f5a8f0e-6b1c-4c37-9a51-2f6a0c9b7d11';
    expect(caseNotificationId('case.created', 'case-1', identity)).toBe(`case.created-case-1-${identity}`);
    expect(caseNotificationId('case.document_generated', 'd'.repeat(100), identity).length).toBeLessThanOrEqual(128);
    expect(intakeNotificationId('s'.repeat(100), identity).length).toBeLessThanOrEqual(128);
    expect(intakeNotificationId('sub-1', identity)).toBe(`intake-attention-sub-1-${identity}`);
  });
});
