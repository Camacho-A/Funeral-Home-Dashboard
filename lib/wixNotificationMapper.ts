import type { Notification, NotificationStatus, RecipientScope } from '../types/notification';

/**
 * Phase 28 (Communications & Notifications). Standard mapper pair for the
 * `notifications` collection — "what happened," carrying zero delivery
 * state (see types/notification.ts's own header comment). A single
 * scoped patch function, mirroring `lib/wixSignatureRequestMapper.ts`'s/
 * `lib/wixAppointmentMapper.ts`'s own precedent — a lifecycle transition
 * here routinely sets more than one field together.
 */

export type WixNotificationItem = {
  beaconNotificationId?: unknown;
  organizationId?: unknown;
  notificationType?: unknown;
  category?: unknown;
  title?: unknown;
  body?: unknown;
  actionUrl?: unknown;
  entityType?: unknown;
  entityId?: unknown;
  recipientScope?: unknown;
  recipientRoleKey?: unknown;
  status?: unknown;
  actorIdentityId?: unknown;
  correlationId?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const VALID_STATUSES: readonly string[] = ['draft', 'queued', 'active', 'archived', 'cancelled'];
const VALID_RECIPIENT_SCOPES: readonly string[] = ['individual', 'role', 'organization_wide', 'case_participants'];

function isNotificationStatus(value: unknown): value is NotificationStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value);
}

function isRecipientScope(value: unknown): value is RecipientScope {
  return typeof value === 'string' && VALID_RECIPIENT_SCOPES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixNotificationItem(item: WixNotificationItem | undefined): Notification | null {
  if (
    !item ||
    typeof item.beaconNotificationId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.notificationType !== 'string' ||
    typeof item.category !== 'string' ||
    typeof item.title !== 'string' ||
    typeof item.body !== 'string' ||
    !isStringOrNull(item.actionUrl) ||
    !isStringOrNull(item.entityType) ||
    !isStringOrNull(item.entityId) ||
    !isRecipientScope(item.recipientScope) ||
    !isStringOrNull(item.recipientRoleKey) ||
    !isNotificationStatus(item.status) ||
    !isStringOrNull(item.actorIdentityId) ||
    typeof item.correlationId !== 'string' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconNotificationId,
    organizationId: item.organizationId,
    notificationType: item.notificationType,
    category: item.category,
    title: item.title,
    body: item.body,
    actionUrl: item.actionUrl,
    entityType: item.entityType,
    entityId: item.entityId,
    recipientScope: item.recipientScope,
    recipientRoleKey: item.recipientRoleKey,
    status: item.status,
    actorIdentityId: item.actorIdentityId,
    correlationId: item.correlationId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixNotificationData(notification: Notification): WixNotificationItem {
  return {
    beaconNotificationId: notification.id,
    organizationId: notification.organizationId,
    notificationType: notification.notificationType,
    category: notification.category,
    title: notification.title,
    body: notification.body,
    actionUrl: notification.actionUrl,
    entityType: notification.entityType,
    entityId: notification.entityId,
    recipientScope: notification.recipientScope,
    recipientRoleKey: notification.recipientRoleKey,
    status: notification.status,
    actorIdentityId: notification.actorIdentityId,
    correlationId: notification.correlationId,
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt,
  };
}

export function applyNotificationPatchToWixData(existing: WixNotificationItem, patch: Partial<WixNotificationItem>): WixNotificationItem {
  return { ...existing, ...patch };
}
