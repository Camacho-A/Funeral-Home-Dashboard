import type { NotificationRecipient } from '../types/notificationRecipient';

/**
 * Phase 28 (Communications & Notifications). Standard mapper pair for the
 * `notificationRecipients` collection — the immutable resolution
 * snapshot. `readAt`/`archivedAt` are the only fields ever changed after
 * insert (denormalized convenience fields — see
 * types/notificationRecipient.ts's own header comment for why); every
 * other field is set once, at creation, and never touched again.
 */
export type WixNotificationRecipientItem = {
  beaconNotificationRecipientId?: unknown;
  organizationId?: unknown;
  notificationId?: unknown;
  identityId?: unknown;
  readAt?: unknown;
  archivedAt?: unknown;
  createdAt?: unknown;
};

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixNotificationRecipientItem(item: WixNotificationRecipientItem | undefined): NotificationRecipient | null {
  if (
    !item ||
    typeof item.beaconNotificationRecipientId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.notificationId !== 'string' ||
    typeof item.identityId !== 'string' ||
    !isStringOrNull(item.readAt) ||
    !isStringOrNull(item.archivedAt) ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconNotificationRecipientId,
    organizationId: item.organizationId,
    notificationId: item.notificationId,
    identityId: item.identityId,
    readAt: item.readAt,
    archivedAt: item.archivedAt,
    createdAt: item.createdAt,
  };
}

export function buildWixNotificationRecipientData(recipient: NotificationRecipient): WixNotificationRecipientItem {
  return {
    beaconNotificationRecipientId: recipient.id,
    organizationId: recipient.organizationId,
    notificationId: recipient.notificationId,
    identityId: recipient.identityId,
    readAt: recipient.readAt,
    archivedAt: recipient.archivedAt,
    createdAt: recipient.createdAt,
  };
}

/** The only fields ever changed on an already-inserted recipient row. */
export function applyNotificationRecipientUpdateToWixData(
  existing: WixNotificationRecipientItem,
  patch: Partial<Pick<WixNotificationRecipientItem, 'readAt' | 'archivedAt'>>,
): WixNotificationRecipientItem {
  return { ...existing, ...patch };
}
