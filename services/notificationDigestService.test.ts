import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNotificationDigestSweep } from './notificationDigestService';
import { updatePreferences } from './notificationService';
import {
  notificationFixtures,
  notificationDeliveryFixtures,
  notificationDeliveryAttemptFixtures,
  notificationPreferenceFixtures,
} from './__mocks__/notificationFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { MANORS_ADMIN_IDENTITY_ID, MANORS_CHRIS_IDENTITY_ID } from './__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { Notification } from '../types/notification';
import type { NotificationDelivery } from '../types/notificationDelivery';

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  notificationFixtures.length = 0;
  notificationDeliveryFixtures.length = 0;
  notificationDeliveryAttemptFixtures.length = 0;
  notificationPreferenceFixtures.length = 0;
  activityEventFixtures.length = 0;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  notificationFixtures.length = 0;
  notificationDeliveryFixtures.length = 0;
  notificationDeliveryAttemptFixtures.length = 0;
  notificationPreferenceFixtures.length = 0;
  activityEventFixtures.length = 0;
  logSpy.mockRestore();
});

function seedNotification(overrides: Partial<Notification> = {}): Notification {
  const notification: Notification = {
    id: `notif-${notificationFixtures.length + 1}`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    notificationType: 'task.assigned',
    category: 'task',
    title: 'Task assigned',
    body: 'Dana assigned you a task',
    actionUrl: '/tasks/123',
    entityType: null,
    entityId: null,
    recipientScope: 'individual',
    recipientRoleKey: null,
    status: 'active',
    actorIdentityId: null,
    correlationId: `corr-${notificationFixtures.length + 1}`,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
  notificationFixtures.push(notification);
  return notification;
}

function seedQueuedDelivery(notification: Notification, identityId: string, overrides: Partial<NotificationDelivery> = {}): NotificationDelivery {
  const delivery: NotificationDelivery = {
    id: `${notification.id}-${identityId}-email`,
    organizationId: notification.organizationId,
    notificationId: notification.id,
    notificationRecipientId: `${notification.id}-${identityId}`,
    identityId,
    channel: 'email',
    status: 'queued_for_digest',
    attemptCount: 0,
    lastAttemptAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
  notificationDeliveryFixtures.push(delivery);
  return delivery;
}

describe('runNotificationDigestSweep', () => {
  it('groups across organizations correctly — each group flushed or skipped independently', async () => {
    await updatePreferences(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, { digestFrequency: 'daily' }, 'mock');
    await updatePreferences(SECOND_MOCK_ORGANIZATION_ID, MANORS_CHRIS_IDENTITY_ID, { digestFrequency: 'daily' }, 'mock');
    // MANORS_ADMIN already had a digest sent recently — not yet eligible.
    await updatePreferences(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, {}, 'mock');
    notificationPreferenceFixtures.find((p) => p.organizationId === DEFAULT_ORGANIZATION_ID && p.identityId === MANORS_ADMIN_IDENTITY_ID)!.lastDigestSentAt =
      new Date().toISOString();

    const n1 = seedNotification({ organizationId: DEFAULT_ORGANIZATION_ID });
    seedQueuedDelivery(n1, MANORS_ADMIN_IDENTITY_ID);
    const n2 = seedNotification({ organizationId: SECOND_MOCK_ORGANIZATION_ID });
    seedQueuedDelivery(n2, MANORS_CHRIS_IDENTITY_ID);

    const result = await runNotificationDigestSweep('mock');
    expect(result.groupsConsidered).toBe(2);
    expect(result.groupsFlushed).toBe(1); // only the SECOND_MOCK_ORGANIZATION_ID / Chris group (never sent before)
    expect(result.groupsSkipped).toBe(1); // DEFAULT_ORGANIZATION_ID / admin group, interval not elapsed
  });

  it('leaves a not-yet-eligible daily group queued, untouched', async () => {
    await updatePreferences(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, { digestFrequency: 'daily' }, 'mock');
    notificationPreferenceFixtures.find((p) => p.identityId === MANORS_ADMIN_IDENTITY_ID)!.lastDigestSentAt = new Date().toISOString();

    const n1 = seedNotification();
    const delivery = seedQueuedDelivery(n1, MANORS_ADMIN_IDENTITY_ID);

    const result = await runNotificationDigestSweep('mock');
    expect(result.groupsFlushed).toBe(0);
    expect(result.groupsSkipped).toBe(1);
    const stillQueued = notificationDeliveryFixtures.find((d) => d.id === delivery.id);
    expect(stillQueued?.status).toBe('queued_for_digest');
    expect(stillQueued?.attemptCount).toBe(0);
  });

  it('flushes an eligible group: sends one combined email, marks every delivery sent, advances lastDigestSentAt', async () => {
    await updatePreferences(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, { digestFrequency: 'daily' }, 'mock');
    // Never sent before — immediately eligible.

    const n1 = seedNotification({ title: 'First', body: 'First body' });
    const n2 = seedNotification({ title: 'Second', body: 'Second body' });
    const d1 = seedQueuedDelivery(n1, MANORS_ADMIN_IDENTITY_ID);
    const d2 = seedQueuedDelivery(n2, MANORS_ADMIN_IDENTITY_ID, { id: `${n2.id}-${MANORS_ADMIN_IDENTITY_ID}-email` });

    const result = await runNotificationDigestSweep('mock');
    expect(result.groupsFlushed).toBe(1);
    expect(result.deliveriesFlushed).toBe(2);

    expect(notificationDeliveryFixtures.find((d) => d.id === d1.id)?.status).toBe('sent');
    expect(notificationDeliveryFixtures.find((d) => d.id === d2.id)?.status).toBe('sent');
    expect(notificationDeliveryAttemptFixtures.filter((a) => a.succeeded)).toHaveLength(2);

    const preference = notificationPreferenceFixtures.find((p) => p.identityId === MANORS_ADMIN_IDENTITY_ID);
    expect(preference?.lastDigestSentAt).not.toBeNull();

    // Best-effort activity events recorded, caseId: null (a digest spans no single case).
    const delivered = activityEventFixtures.filter((e) => e.eventType === 'notification.delivered');
    expect(delivered).toHaveLength(2);
    expect(delivered.every((e) => e.caseId === null)).toBe(true);
  });

  it('an instant preference whose row is queued purely for quiet hours flushes once past quietHoursEnd, stays queued while still inside it', async () => {
    const identityId = MANORS_ADMIN_IDENTITY_ID;
    const n1 = seedNotification();
    seedQueuedDelivery(n1, identityId);
    await updatePreferences(DEFAULT_ORGANIZATION_ID, identityId, { quietHoursStart: '22:00', quietHoursEnd: '07:00' }, 'mock');

    const stillInside = await runNotificationDigestSweep('mock', '2026-08-01T23:30:00.000Z');
    expect(stillInside.groupsSkipped).toBe(1);
    expect(stillInside.groupsFlushed).toBe(0);
    expect(notificationDeliveryFixtures[0].status).toBe('queued_for_digest');

    const afterWindow = await runNotificationDigestSweep('mock', '2026-08-02T08:00:00.000Z');
    expect(afterWindow.groupsFlushed).toBe(1);
  });

  it('a mixed sweep flushes eligible groups and leaves ineligible ones queued in the same pass', async () => {
    await updatePreferences(DEFAULT_ORGANIZATION_ID, MANORS_ADMIN_IDENTITY_ID, { digestFrequency: 'weekly' }, 'mock');
    notificationPreferenceFixtures.find((p) => p.identityId === MANORS_ADMIN_IDENTITY_ID)!.lastDigestSentAt = new Date().toISOString(); // not eligible

    await updatePreferences(DEFAULT_ORGANIZATION_ID, MANORS_CHRIS_IDENTITY_ID, { digestFrequency: 'daily' }, 'mock'); // never sent — eligible

    const n1 = seedNotification();
    seedQueuedDelivery(n1, MANORS_ADMIN_IDENTITY_ID);
    const n2 = seedNotification();
    seedQueuedDelivery(n2, MANORS_CHRIS_IDENTITY_ID, { id: `${n2.id}-${MANORS_CHRIS_IDENTITY_ID}-email` });

    const result = await runNotificationDigestSweep('mock');
    expect(result.groupsConsidered).toBe(2);
    expect(result.groupsFlushed).toBe(1);
    expect(result.groupsSkipped).toBe(1);
  });
});
