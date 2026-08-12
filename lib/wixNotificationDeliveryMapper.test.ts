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

const SMS_DELIVERY: NotificationDelivery = {
  ...IN_APP_DELIVERY,
  id: 'notif-1-identity-1-sms',
  channel: 'sms',
  status: 'sent',
  attemptCount: 1,
};

const QUEUED_FOR_DIGEST_DELIVERY: NotificationDelivery = {
  ...EMAIL_DELIVERY,
  status: 'queued_for_digest',
  attemptCount: 0,
  lastAttemptAt: null,
};

describe('wixNotificationDeliveryMapper', () => {
  it('round-trips an in-app delivery', () => {
    expect(mapWixNotificationDeliveryItem(buildWixNotificationDeliveryData(IN_APP_DELIVERY))).toEqual(IN_APP_DELIVERY);
  });

  it('round-trips a failed email delivery', () => {
    expect(mapWixNotificationDeliveryItem(buildWixNotificationDeliveryData(EMAIL_DELIVERY))).toEqual(EMAIL_DELIVERY);
  });

  it('Phase 33: round-trips an sms delivery', () => {
    expect(mapWixNotificationDeliveryItem(buildWixNotificationDeliveryData(SMS_DELIVERY))).toEqual(SMS_DELIVERY);
  });

  it('Phase 33: round-trips a queued_for_digest delivery', () => {
    expect(mapWixNotificationDeliveryItem(buildWixNotificationDeliveryData(QUEUED_FOR_DIGEST_DELIVERY))).toEqual(QUEUED_FOR_DIGEST_DELIVERY);
  });

  it('returns null for undefined', () => {
    expect(mapWixNotificationDeliveryItem(undefined)).toBeNull();
  });

  it('returns null for an invalid channel/status', () => {
    expect(mapWixNotificationDeliveryItem({ ...buildWixNotificationDeliveryData(IN_APP_DELIVERY), channel: 'carrier_pigeon' })).toBeNull();
    expect(mapWixNotificationDeliveryItem({ ...buildWixNotificationDeliveryData(IN_APP_DELIVERY), status: 'bogus' })).toBeNull();
  });

  it('applyNotificationDeliveryUpdateToWixData changes only status/attemptCount/lastAttemptAt', () => {
    const wixItem = buildWixNotificationDeliveryData(IN_APP_DELIVERY);
    const updated = applyNotificationDeliveryUpdateToWixData(wixItem, { status: 'read' });
    expect(updated.status).toBe('read');
    expect(updated.channel).toBe(wixItem.channel);
  });
});
