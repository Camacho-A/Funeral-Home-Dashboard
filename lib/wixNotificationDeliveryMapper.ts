import type { NotificationDelivery, NotificationChannel, DeliveryStatus } from '../types/notificationDelivery';

/**
 * Phase 28 (Communications & Notifications). Standard mapper pair for the
 * `notificationDeliveries` collection — "how it was sent," carrying zero
 * notification content (see types/notificationDelivery.ts's own header
 * comment). `identityId` is denormalized from `NotificationRecipient` so
 * the unread-badge query never needs a join.
 */
export type WixNotificationDeliveryItem = {
  beaconNotificationDeliveryId?: unknown;
  organizationId?: unknown;
  notificationId?: unknown;
  notificationRecipientId?: unknown;
  identityId?: unknown;
  channel?: unknown;
  status?: unknown;
  attemptCount?: unknown;
  lastAttemptAt?: unknown;
  createdAt?: unknown;
};

const VALID_CHANNELS: readonly string[] = ['in_app', 'email'];
const VALID_STATUSES: readonly string[] = ['pending', 'sent', 'delivered', 'read', 'failed'];

function isChannel(value: unknown): value is NotificationChannel {
  return typeof value === 'string' && VALID_CHANNELS.includes(value);
}

function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixNotificationDeliveryItem(item: WixNotificationDeliveryItem | undefined): NotificationDelivery | null {
  if (
    !item ||
    typeof item.beaconNotificationDeliveryId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.notificationId !== 'string' ||
    typeof item.notificationRecipientId !== 'string' ||
    typeof item.identityId !== 'string' ||
    !isChannel(item.channel) ||
    !isDeliveryStatus(item.status) ||
    typeof item.attemptCount !== 'number' ||
    !isStringOrNull(item.lastAttemptAt) ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconNotificationDeliveryId,
    organizationId: item.organizationId,
    notificationId: item.notificationId,
    notificationRecipientId: item.notificationRecipientId,
    identityId: item.identityId,
    channel: item.channel,
    status: item.status,
    attemptCount: item.attemptCount,
    lastAttemptAt: item.lastAttemptAt,
    createdAt: item.createdAt,
  };
}

export function buildWixNotificationDeliveryData(delivery: NotificationDelivery): WixNotificationDeliveryItem {
  return {
    beaconNotificationDeliveryId: delivery.id,
    organizationId: delivery.organizationId,
    notificationId: delivery.notificationId,
    notificationRecipientId: delivery.notificationRecipientId,
    identityId: delivery.identityId,
    channel: delivery.channel,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    lastAttemptAt: delivery.lastAttemptAt,
    createdAt: delivery.createdAt,
  };
}

/** The only fields ever changed on an already-inserted delivery row. */
export function applyNotificationDeliveryUpdateToWixData(
  existing: WixNotificationDeliveryItem,
  patch: Partial<Pick<WixNotificationDeliveryItem, 'status' | 'attemptCount' | 'lastAttemptAt'>>,
): WixNotificationDeliveryItem {
  return { ...existing, ...patch };
}
