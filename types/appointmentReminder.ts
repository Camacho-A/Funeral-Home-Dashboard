/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated Reminders).
 * One row per (appointment, lead time, recipient) — the pre-computed,
 * cron-swept unit of work behind automated appointment reminders. Rows
 * are scheduled eagerly by `services/appointmentReminderService.ts` at
 * the same lifecycle points `schedulingService.ts` already notifies the
 * appointment owner from (create/reschedule/cancel/complete), never
 * derived lazily by scanning `appointments` — that collection has zero
 * free regular-index slots (confirmed live, see
 * docs/WIX_DATA_SCHEMA.md), and a bounded, indexed sweep against this
 * collection's own `(status, scheduledFor)` index is the only access
 * pattern this phase adds. See
 * docs/adr/ADR-038-scheduling-integrations-calendar-sync-and-reminders.md.
 *
 * `id` is deterministic — `${appointmentId}-${leadTimeMinutes}-${recipientType}-${recipientRef}`
 * — so re-scheduling reminders for an unchanged appointment upserts
 * rather than duplicates, and the sweep's own status flip (the very next
 * persisted action after a successful `createNotification` call) is the
 * whole idempotency mechanism. There is deliberately no `'processing'`
 * intermediate state: Wix Data has no optimistic-concurrency/compare-
 * and-swap support (confirmed negative, Phase 22), so this carries the
 * same disclosed, low-probability concurrent-overlap limitation
 * `notificationDigestService.ts`'s sweep already accepted rather than
 * inventing a guarantee this stack cannot actually provide.
 */
export type ReminderRecipientType = 'staff_owner' | 'family_portal_user';

export type ReminderStatus = 'scheduled' | 'sent' | 'skipped' | 'cancelled' | 'failed';

export type AppointmentReminder = {
  id: string;
  organizationId: string;
  appointmentId: string;
  /** Minutes before Appointment.startAt this reminder is due — e.g. 120
      (2h), 1440 (24h), 4320 (3d), 10080 (7d). Sourced from the
      organization's SchedulingReminderPolicy.leadTimesMinutes at
      scheduling time, not re-read at send time. */
  leadTimeMinutes: number;
  recipientType: ReminderRecipientType;
  /** Set only when recipientType === 'staff_owner' — resolved through
      Appointment.ownerStaffProfileId -> StaffProfile.identityId, never
      inferred from a display name or email. A row is only ever created
      once a recipient actually resolves — an appointment with no owner
      assigned at all produces no staff_owner rows (mirrors
      schedulingService.ts's own notifyAppointmentOwner: "no owner is a
      valid, non-error outcome, not every appointment has one"). An
      owner that IS assigned but whose StaffProfile/Membership isn't
      active produces a row anyway, immediately status: 'skipped' — the
      anomalous case worth operational visibility into. */
  recipientIdentityId: string | null;
  /** Set only when recipientType === 'family_portal_user' — a
      PortalUser.id, never an Identity.id, mirroring
      recipientResolver.ts's own 'portal_user' scope convention. One row
      per active PortalAccess grant with the appointment.read
      capability on the appointment's case. */
  recipientPortalUserId: string | null;
  /** ISO instant = Appointment.startAt minus leadTimeMinutes. An
      absolute instant — no timezone conversion needed here; timezone
      only matters for quiet-hours/display formatting, both already
      NotificationService's job once dispatch happens. */
  scheduledFor: string;
  status: ReminderStatus;
  /** Set once createNotification() succeeds — traceability, and the
      thing that actually stops a re-matched row from double-sending
      (the status flip away from 'scheduled' happens in the same step). */
  notificationId: string | null;
  sentAt: string | null;
  cancelledAt: string | null;
  /** Populated for both 'skipped' (unresolvable recipient, known at
      schedule time) and 'failed' (notification dispatch itself threw). */
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};
