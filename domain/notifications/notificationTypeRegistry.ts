/**
 * Phase 28 (Communications & Notifications). The stable, machine-readable
 * notification-type taxonomy every `Notification.notificationType` picks
 * exactly one entry from — mirrors `domain/scheduling/appointmentTypeRegistry.ts`'s
 * `APPOINTMENT_TYPES` convention exactly: dot-notation identifiers
 * prefixed by their own `category` (matching `ACTIVITY_EVENT_TYPES`'s own
 * `scheduling.appointment.created`-style convention, e.g.
 * `scheduling.appointment_created`), a separate `displayName` (never
 * derived from the key), and this registry (not a hardcoded union on
 * `Notification` itself) is the source of truth for what a notification
 * type "is."
 *
 * `category` is deliberately `'scheduling'`, not `'appointment'` — the
 * exact value `ActivityEventCategory` already reserved in Phase 27, so a
 * scheduling-triggered notification and its corresponding `ActivityEvent`
 * agree on vocabulary instead of introducing a second, slightly-different
 * taxonomy.
 *
 * Six entries below have a real, wired emitter this phase (scheduling's
 * three + task.assigned + signature's two); the remaining five are fully
 * real registry entries — covered by tests, the UI, and live
 * verification — with no production call site emitting them yet (see
 * ADR-032's "Bounded integration surface" section for why).
 */
export type NotificationCategory = 'case' | 'task' | 'payment' | 'scheduling' | 'document' | 'signature' | 'organization' | 'system';

export const NOTIFICATION_TYPES = {
  APPOINTMENT_CREATED: { key: 'scheduling.appointment_created', category: 'scheduling' as NotificationCategory, displayName: 'Appointment Scheduled' },
  APPOINTMENT_RESCHEDULED: { key: 'scheduling.appointment_rescheduled', category: 'scheduling' as NotificationCategory, displayName: 'Appointment Rescheduled' },
  APPOINTMENT_CANCELLED: { key: 'scheduling.appointment_cancelled', category: 'scheduling' as NotificationCategory, displayName: 'Appointment Cancelled' },

  TASK_ASSIGNED: { key: 'task.assigned', category: 'task' as NotificationCategory, displayName: 'Task Assigned' },

  SIGNATURE_COMPLETED: { key: 'signature.completed', category: 'signature' as NotificationCategory, displayName: 'Document Signed' },
  SIGNATURE_DECLINED: { key: 'signature.declined', category: 'signature' as NotificationCategory, displayName: 'Signature Declined' },

  // Reserved this phase — real registry entries, no wired emitter yet (see ADR-032).
  CASE_CREATED: { key: 'case.created', category: 'case' as NotificationCategory, displayName: 'New Case' },
  DOCUMENT_GENERATED: { key: 'document.generated', category: 'document' as NotificationCategory, displayName: 'Document Generated' },
  PAYMENT_RECEIVED: { key: 'payment.received', category: 'payment' as NotificationCategory, displayName: 'Payment Received' },
  ORGANIZATION_MEMBER_JOINED: { key: 'organization.member_joined', category: 'organization' as NotificationCategory, displayName: 'Team Member Joined' },
  SYSTEM_ANNOUNCEMENT: { key: 'system.announcement', category: 'system' as NotificationCategory, displayName: 'System Announcement' },
} as const;

export type NotificationTypeDefinition = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];
export type NotificationTypeKey = NotificationTypeDefinition['key'];

const NOTIFICATION_TYPES_BY_KEY: Record<string, NotificationTypeDefinition> = Object.fromEntries(
  Object.values(NOTIFICATION_TYPES).map((entry) => [entry.key, entry]),
);

export function isValidNotificationTypeKey(key: string): key is NotificationTypeKey {
  return key in NOTIFICATION_TYPES_BY_KEY;
}

export function getNotificationTypeDefinition(key: string): NotificationTypeDefinition | null {
  return NOTIFICATION_TYPES_BY_KEY[key] ?? null;
}

/** Display labels for the 8 broad `NotificationCategory` values — a
    domain decision, kept out of UI components per `Badge`'s own
    convention (see `domain/scheduling/appointmentTypeRegistry.ts`'s
    identical `APPOINTMENT_TYPE_CATEGORY_LABEL` for the same pattern). */
export const NOTIFICATION_CATEGORY_LABEL: Record<NotificationCategory, string> = {
  case: 'Case',
  task: 'Task',
  payment: 'Payment',
  scheduling: 'Scheduling',
  document: 'Document',
  signature: 'Signature',
  organization: 'Organization',
  system: 'System',
};
