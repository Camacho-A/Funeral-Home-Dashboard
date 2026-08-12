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
 * Six entries had a real, wired emitter as of Phase 30 (scheduling's
 * three + signature's two, wired in Phase 28; `task.assigned`, wired in
 * Phase 30 — see ADR-034 — Phase 28 deferred it pending the
 * `StaffProfile`-identity gap ADR-034 closes). Phase 34 (Scheduling
 * Integrations, Calendar Sync & Automated Reminders) wires two more:
 * the new `scheduling.appointment_reminder`, and — for the first time —
 * a real emitter for `family.appointment_reminder` below, which had sat
 * as a real, registered-but-unwired entry since Phase 28. The remaining
 * entries are fully real registry entries — covered by tests, the UI,
 * and live verification — with no production call site emitting them
 * yet (see ADR-032's "Bounded integration surface" section for why).
 */
export type NotificationCategory = 'case' | 'task' | 'payment' | 'scheduling' | 'document' | 'signature' | 'organization' | 'system' | 'family_portal' | 'financial';

export const NOTIFICATION_TYPES = {
  APPOINTMENT_CREATED: { key: 'scheduling.appointment_created', category: 'scheduling' as NotificationCategory, displayName: 'Appointment Scheduled' },
  APPOINTMENT_RESCHEDULED: { key: 'scheduling.appointment_rescheduled', category: 'scheduling' as NotificationCategory, displayName: 'Appointment Rescheduled' },
  APPOINTMENT_CANCELLED: { key: 'scheduling.appointment_cancelled', category: 'scheduling' as NotificationCategory, displayName: 'Appointment Cancelled' },
  /** Phase 34 (Scheduling Integrations, Calendar Sync & Automated
      Reminders). The staff-owner sibling of FAMILY_APPOINTMENT_REMINDER
      below — delivered via recipientScope: 'individual' to
      Appointment.ownerStaffProfileId's resolved Identity, emitted by
      services/appointmentReminderService.ts's cron sweep, never at
      appointment-creation time. */
  APPOINTMENT_REMINDER: { key: 'scheduling.appointment_reminder', category: 'scheduling' as NotificationCategory, displayName: 'Appointment Reminder' },

  TASK_ASSIGNED: { key: 'task.assigned', category: 'task' as NotificationCategory, displayName: 'Task Assigned' },

  SIGNATURE_COMPLETED: { key: 'signature.completed', category: 'signature' as NotificationCategory, displayName: 'Document Signed' },
  SIGNATURE_DECLINED: { key: 'signature.declined', category: 'signature' as NotificationCategory, displayName: 'Signature Declined' },

  // Reserved this phase — real registry entries, no wired emitter yet (see ADR-032).
  CASE_CREATED: { key: 'case.created', category: 'case' as NotificationCategory, displayName: 'New Case' },
  DOCUMENT_GENERATED: { key: 'document.generated', category: 'document' as NotificationCategory, displayName: 'Document Generated' },
  PAYMENT_RECEIVED: { key: 'payment.received', category: 'payment' as NotificationCategory, displayName: 'Payment Received' },
  ORGANIZATION_MEMBER_JOINED: { key: 'organization.member_joined', category: 'organization' as NotificationCategory, displayName: 'Team Member Joined' },
  SYSTEM_ANNOUNCEMENT: { key: 'system.announcement', category: 'system' as NotificationCategory, displayName: 'System Announcement' },
  /** Phase 34. Delivered via recipientScope: 'individual' to the owning
      staff member's Identity, emitted only on the terminal
      retry_pending -> failed transition (services/calendar/
      calendarSyncService.ts) — never per transient retry, matching
      this codebase's own "no notification noise for routine/transient
      events" discipline. */
  CALENDAR_SYNC_FAILED: { key: 'system.calendar_sync_failed', category: 'system' as NotificationCategory, displayName: 'Calendar Sync Failed' },

  // Phase 29 (Family Portal & External Collaboration). Delivered exclusively
  // via the new `recipientScope: 'portal_user'` (see types/notification.ts) —
  // never `individual`, since a Portal User is not an Identity.
  FAMILY_DOCUMENT_READY: { key: 'family.document_ready', category: 'family_portal' as NotificationCategory, displayName: 'Document Ready' },
  FAMILY_SIGNATURE_REQUESTED: { key: 'family.signature_requested', category: 'family_portal' as NotificationCategory, displayName: 'Signature Requested' },
  FAMILY_APPOINTMENT_REMINDER: { key: 'family.appointment_reminder', category: 'family_portal' as NotificationCategory, displayName: 'Appointment Reminder' },
  FAMILY_PAYMENT_REMINDER: { key: 'family.payment_reminder', category: 'family_portal' as NotificationCategory, displayName: 'Payment Reminder' },
  FAMILY_MESSAGE_RECEIVED: { key: 'family.message_received', category: 'family_portal' as NotificationCategory, displayName: 'New Message' },
  FAMILY_GENERAL_UPDATE: { key: 'family.general_update', category: 'family_portal' as NotificationCategory, displayName: 'Case Update' },
  /** The staff-facing sibling of FAMILY_MESSAGE_RECEIVED — delivered via
      the ordinary `recipientScope: 'role'` (never `portal_user`) when a
      family member sends a message, mirroring `signatureService.ts`'s own
      "notify the requester" internal-notification pattern from Phase 28.
      No existing staff-facing type fit this ("system.announcement"'s
      generic body doesn't convey a new-message context), so this is a
      small, additive registry entry rather than an awkward reuse. */
  PORTAL_STAFF_MESSAGE_RECEIVED: { key: 'portal.staff_message_received', category: 'family_portal' as NotificationCategory, displayName: 'Family Portal Message' },

  // Phase 31 (Financial Management & General Ledger). All delivered via
  // recipientScope: 'role' / roleKey: 'accounting' — never an individual
  // staff member, since financial review is a role-level responsibility.
  // Reserved this phase — real registry entries, no wired emitter yet
  // (same "Bounded integration surface" pattern as the CASE_CREATED/
  // DOCUMENT_GENERATED/etc. entries above). INVOICE_OVERDUE in particular
  // can only ever be evaluated on-demand (e.g. when the AR Aging report is
  // viewed) — Beacon has no background/scheduled-job infrastructure
  // anywhere to fire it on a true nightly schedule; a disclosed, deferred
  // gap (see ADR-035's own Deferred section), not glossed over.
  JOURNAL_ENTRY_NEEDS_REVIEW: { key: 'financial.journal_entry_needs_review', category: 'financial' as NotificationCategory, displayName: 'Journal Entry Needs Review' },
  RECONCILIATION_COMPLETED: { key: 'financial.reconciliation_completed', category: 'financial' as NotificationCategory, displayName: 'Reconciliation Completed' },
  INVOICE_OVERDUE: { key: 'financial.invoice_overdue', category: 'financial' as NotificationCategory, displayName: 'Invoice Overdue' },
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
  family_portal: 'Family Portal',
  financial: 'Financial',
};
