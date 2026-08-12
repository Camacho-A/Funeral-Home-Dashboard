/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated Reminders).
 * The mapping between one Beacon `Appointment` and its projection onto
 * one external calendar (via one `CalendarConnection`) — one-way,
 * Beacon-authoritative sync only (see
 * docs/adr/ADR-038-scheduling-integrations-calendar-sync-and-reminders.md's
 * "Synchronization model" section for why two-way sync is explicitly
 * out of scope this phase).
 *
 * `id` is deterministic (`${appointmentId}-${calendarConnectionId}`),
 * which is what makes synchronization idempotent — a second "sync this
 * appointment" trigger for the same (appointment, connection) pair
 * upserts the existing row rather than creating a duplicate external
 * event.
 *
 * A row existing always means an external event exists (or is pending
 * creation) — once an appointment is cancelled and the sweep confirms
 * the external event is deleted, the row itself is deleted too, never
 * left around in a terminal "deleted" state.
 */
export type CalendarSyncStatus = 'pending' | 'synced' | 'retry_pending' | 'failed' | 'disconnected';

export type CalendarEventLink = {
  id: string;
  organizationId: string;
  appointmentId: string;
  calendarConnectionId: string;
  /** Denormalized from the connection, for convenience. */
  provider: 'google' | 'microsoft';
  externalCalendarId: string;
  /** Null until the first successful create. */
  externalEventId: string | null;
  syncStatus: CalendarSyncStatus;
  /** Appointment.appointmentVersion as of the last successful sync —
      lets the sweep detect "this appointment changed since we last
      pushed it" without a second, separate dirty flag. */
  beaconAppointmentVersion: number;
  lastSyncedAt: string | null;
  /** Bounded, human-readable — never token material. */
  lastError: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
};
