import type { NotificationDeliveryAttempt } from '../types/notificationDeliveryAttempt';

/**
 * Phase 28 (Communications & Notifications). Standard mapper pair for the
 * `notificationDeliveryAttempts` collection. Deliberately no update/apply
 * function at all — mirrors `lib/wixSignatureRecordMapper.ts`'s own
 * insert-only convention exactly: a `NotificationDeliveryAttempt`, once
 * created, is never edited or deleted.
 */
export type WixNotificationDeliveryAttemptItem = {
  beaconNotificationDeliveryAttemptId?: unknown;
  organizationId?: unknown;
  notificationDeliveryId?: unknown;
  succeeded?: unknown;
  errorMessage?: unknown;
  attemptedAt?: unknown;
};

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixNotificationDeliveryAttemptItem(item: WixNotificationDeliveryAttemptItem | undefined): NotificationDeliveryAttempt | null {
  if (
    !item ||
    typeof item.beaconNotificationDeliveryAttemptId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.notificationDeliveryId !== 'string' ||
    typeof item.succeeded !== 'boolean' ||
    !isStringOrNull(item.errorMessage) ||
    typeof item.attemptedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconNotificationDeliveryAttemptId,
    organizationId: item.organizationId,
    notificationDeliveryId: item.notificationDeliveryId,
    succeeded: item.succeeded,
    errorMessage: item.errorMessage,
    attemptedAt: item.attemptedAt,
  };
}

export function buildWixNotificationDeliveryAttemptData(attempt: NotificationDeliveryAttempt): WixNotificationDeliveryAttemptItem {
  return {
    beaconNotificationDeliveryAttemptId: attempt.id,
    organizationId: attempt.organizationId,
    notificationDeliveryId: attempt.notificationDeliveryId,
    succeeded: attempt.succeeded,
    errorMessage: attempt.errorMessage,
    attemptedAt: attempt.attemptedAt,
  };
}
