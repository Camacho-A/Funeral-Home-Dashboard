import { describe, it, expect } from 'vitest';
import { mapWixNotificationDeliveryItem, buildWixNotificationDeliveryData, applyNotificationDeliveryUpdateToWixData } from './wixNotificationDeliveryMapper';
import type { NotificationDelivery } from '../types/notificationDelivery';

const IN_APP_DELIVERY: NotificationDelivery = {
  id: 'notif-1-identity-1-in_app',
  organizationId: 'org-1',
  notificationId: 'notif-1',
  notificationRecipientId: 'notif-1-identity-1',
  identityId: 'identity-1',
  channel: 'in_app',
  status: 'delivered',
  attemptCount: 1,
  lastAttemptAt: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const EMAIL_DELIVERY: NotificationDelivery = {
  ...IN_APP_DELIVERY,
  id: 'notif-1-identity-1-email',
  channel: 'email',
  status: 'failed',
  attemptCount: 2,
};

describe('wixNotificationDeliveryMapper', () => {
  it('round-trips an in-app delivery', () => {
    expect(mapWixNotificationDeliveryItem(buildWixNotificationDeliveryData(IN_APP_DELIVERY))).toEqual(IN_APP_DELIVERY);
  });

  it('round-trips a failed email delivery', () => {
    expect(mapWixNotificationDeliveryItem(buildWixNotificationDeliveryData(EMAIL_DELIVERY))).toEqual(EMAIL_DELIVERY);
  });

  it('returns null for undefined', () => {
    expect(mapWixNotificationDeliveryItem(undefined)).toBeNull();
  });

  it('returns null for an invalid channel/status', () => {
    expect(mapWixNotificationDeliveryItem({ ...buildWixNotificationDeliveryData(IN_APP_DELIVERY), channel: 'sms' })).toBeNull();
    expect(mapWixNotificationDeliveryItem({ ...buildWixNotificationDeliveryData(IN_APP_DELIVERY), status: 'bogus' })).toBeNull();
  });

  it('applyNotificationDeliveryUpdateToWixData changes only status/attemptCount/lastAttemptAt', () => {
    const wixItem = buildWixNotificationDeliveryData(IN_APP_DELIVERY);
    const updated = applyNotificationDeliveryUpdateToWixData(wixItem, { status: 'read' });
    expect(updated.status).toBe('read');
    expect(updated.channel).toBe(wixItem.channel);
  });
});
