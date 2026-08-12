/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated Reminders).
 * One row per organization, id = organizationId — a bounded, admin-
 * editable list of reminder lead times, deliberately not a rules
 * engine and deliberately not varied by appointment type (both named
 * as out-of-scope extension points, not built speculatively). A
 * missing row resolves to `DEFAULT_SCHEDULING_REMINDER_POLICY`, a
 * synthetic, unpersisted view — mirrors NotificationPreference's own
 * "missing row = default, never eagerly seeded" pattern exactly. See
 * docs/adr/ADR-038-scheduling-integrations-calendar-sync-and-reminders.md.
 */
export type SchedulingReminderPolicy = {
  organizationId: string;
  /** Sorted ascending, minutes before Appointment.startAt. A small,
      finite list an administrator checks/unchecks — never an arbitrary
      user-authored expression. */
  leadTimesMinutes: number[];
  /** Whether the appointment's owner (via ownerStaffProfileId) receives
      reminders at all. */
  notifyOwner: boolean;
  /** Whether family (Family Portal) recipients receive reminders.
      Default false — an explicit opt-in, never on by default for an
      external-facing surface. When true, eligibility is still derived
      per-appointment (Appointment.caseId set, at least one active
      PortalAccess grant with appointment.read) — this flag is a global
      on/off switch, never itself the eligibility check. */
  notifyFamily: boolean;
  updatedAt: string;
};

export const DEFAULT_SCHEDULING_REMINDER_POLICY: Omit<SchedulingReminderPolicy, 'organizationId' | 'updatedAt'> = {
  leadTimesMinutes: [120, 1440],
  notifyOwner: true,
  notifyFamily: false,
};

export type SchedulingReminderPolicyPatch = Partial<Pick<SchedulingReminderPolicy, 'leadTimesMinutes' | 'notifyOwner' | 'notifyFamily'>>;
