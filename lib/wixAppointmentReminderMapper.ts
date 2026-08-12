import type { AppointmentReminder, ReminderRecipientType, ReminderStatus } from '../types/appointmentReminder';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Standard mapper pair for the `appointmentReminders`
 * collection, mirroring `lib/wixNotificationDeliveryMapper.ts`'s exact
 * shape — an insert-time builder plus a narrow patch-apply function
 * covering only the fields the sweep ever mutates after creation
 * (`status`/`notificationId`/`sentAt`/`cancelledAt`/`failureReason`).
 */

export type WixAppointmentReminderItem = {
  beaconAppointmentReminderId?: unknown;
  organizationId?: unknown;
  appointmentId?: unknown;
  leadTimeMinutes?: unknown;
  recipientType?: unknown;
  recipientIdentityId?: unknown;
  recipientPortalUserId?: unknown;
  scheduledFor?: unknown;
  status?: unknown;
  notificationId?: unknown;
  sentAt?: unknown;
  cancelledAt?: unknown;
  failureReason?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const VALID_RECIPIENT_TYPES: readonly string[] = ['staff_owner', 'family_portal_user'];
const VALID_STATUSES: readonly string[] = ['scheduled', 'sent', 'skipped', 'cancelled', 'failed'];

function isRecipientType(value: unknown): value is ReminderRecipientType {
  return typeof value === 'string' && VALID_RECIPIENT_TYPES.includes(value);
}

function isStatus(value: unknown): value is ReminderStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixAppointmentReminderItem(item: WixAppointmentReminderItem | undefined): AppointmentReminder | null {
  if (
    !item ||
    typeof item.beaconAppointmentReminderId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.appointmentId !== 'string' ||
    typeof item.leadTimeMinutes !== 'number' ||
    !isRecipientType(item.recipientType) ||
    !isStringOrNull(item.recipientIdentityId) ||
    !isStringOrNull(item.recipientPortalUserId) ||
    typeof item.scheduledFor !== 'string' ||
    !isStatus(item.status) ||
    !isStringOrNull(item.notificationId) ||
    !isStringOrNull(item.sentAt) ||
    !isStringOrNull(item.cancelledAt) ||
    !isStringOrNull(item.failureReason) ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconAppointmentReminderId,
    organizationId: item.organizationId,
    appointmentId: item.appointmentId,
    leadTimeMinutes: item.leadTimeMinutes,
    recipientType: item.recipientType,
    recipientIdentityId: item.recipientIdentityId,
    recipientPortalUserId: item.recipientPortalUserId,
    scheduledFor: item.scheduledFor,
    status: item.status,
    notificationId: item.notificationId,
    sentAt: item.sentAt,
    cancelledAt: item.cancelledAt,
    failureReason: item.failureReason,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixAppointmentReminderData(reminder: AppointmentReminder): WixAppointmentReminderItem {
  return {
    beaconAppointmentReminderId: reminder.id,
    organizationId: reminder.organizationId,
    appointmentId: reminder.appointmentId,
    leadTimeMinutes: reminder.leadTimeMinutes,
    recipientType: reminder.recipientType,
    recipientIdentityId: reminder.recipientIdentityId,
    recipientPortalUserId: reminder.recipientPortalUserId,
    scheduledFor: reminder.scheduledFor,
    status: reminder.status,
    notificationId: reminder.notificationId,
    sentAt: reminder.sentAt,
    cancelledAt: reminder.cancelledAt,
    failureReason: reminder.failureReason,
    createdAt: reminder.createdAt,
    updatedAt: reminder.updatedAt,
  };
}

export function applyAppointmentReminderUpdateToWixData(
  existing: WixAppointmentReminderItem,
  patch: Partial<Pick<AppointmentReminder, 'status' | 'notificationId' | 'sentAt' | 'cancelledAt' | 'failureReason' | 'updatedAt'>>,
): WixAppointmentReminderItem {
  const next = { ...existing };
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.notificationId !== undefined) next.notificationId = patch.notificationId;
  if (patch.sentAt !== undefined) next.sentAt = patch.sentAt;
  if (patch.cancelledAt !== undefined) next.cancelledAt = patch.cancelledAt;
  if (patch.failureReason !== undefined) next.failureReason = patch.failureReason;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
