/**
 * SOLIS-wide ALL-CAPS data standard (2026-09). Appointment's own explicit
 * normalization policy. `title`, `notes`, and `cancelReason` are the only
 * staff-entered free-text fields on `Appointment` — every other field is an
 * id, enum, timestamp, or boolean (see types/appointment.ts). Deliberately
 * excludes anything calendar-provider-related (locationId, timezone,
 * recurrenceDefinitionId) and every AppointmentStatus/CalendarSyncStatus
 * literal, none of which are touched by this function since they're never
 * passed to it.
 */
export function normalizeAppointmentTextFields<T extends { title?: unknown; notes?: unknown }>(input: T): T {
  const result: Record<string, unknown> = { ...input };
  if (typeof result.title === 'string') result.title = result.title.toUpperCase();
  if (typeof result.notes === 'string') result.notes = result.notes.toUpperCase();
  return result as T;
}

/** Separate from `normalizeAppointmentTextFields` because `cancelReason` is
    only ever set at cancellation time (services/schedulingService.ts's
    `cancelAppointment`), never alongside title/notes. */
export function normalizeAppointmentCancelReason(cancelReason: string | null): string | null {
  return typeof cancelReason === 'string' ? cancelReason.toUpperCase() : cancelReason;
}
