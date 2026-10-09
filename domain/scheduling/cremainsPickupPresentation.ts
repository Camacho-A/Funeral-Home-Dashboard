import type { Appointment } from '../../types/appointment';
import { APPOINTMENT_TYPES } from './appointmentTypeRegistry';
import { isPickupOverdue, localAllDayWindow, organizationLocalDate, type LocalDate } from './cremainsPickupSchedule';

/**
 * Expected Cremains Pickup — the client-safe half (2026-10).
 *
 * Pure presentation logic, deliberately split out of
 * `services/cremainsPickupService.ts` so Calendar and Case Detail can
 * import it without dragging the server-only scheduling/Wix stack into the
 * client bundle. The service re-exports these, so there is still exactly
 * one implementation of each.
 */

export const EXPECTED_CREMAINS_PICKUP_TYPE = APPOINTMENT_TYPES.EXPECTED_CREMAINS_PICKUP.key;

export function isExpectedCremainsPickup(appointment: Pick<Appointment, 'appointmentType'>): boolean {
  return appointment.appointmentType === EXPECTED_CREMAINS_PICKUP_TYPE;
}

/** The four user-facing states. OVERDUE is derived, never stored. */
export type CremainsPickupStatus = 'estimated' | 'confirmed' | 'overdue' | 'received';

export const PICKUP_STATUS_LABEL: Record<CremainsPickupStatus, string> = {
  estimated: 'Estimated',
  confirmed: 'Confirmed',
  overdue: 'Overdue',
  received: 'Received',
};

/**
 * The expected pickup CALENDAR DATE an appointment represents.
 *
 * All-day representation: `startAt`/`endAt` bracket the day UTC-anchored
 * and the date portion is authoritative. An expected pickup is a calendar
 * day, never a wall-clock moment — SOLIS must never display an invented
 * pickup time.
 */
export function expectedDateOf(appointment: Pick<Appointment, 'startAt' | 'timezone'>): LocalDate | null {
  return organizationLocalDate(appointment.startAt, appointment.timezone);
}

/** The stored instant range for an all-day pickup on `date`, anchored to
    the organization's OWN midnight rather than UTC's. */
export function allDayWindowFor(date: LocalDate, timeZone: string | undefined): { startAt: string; endAt: string } {
  return localAllDayWindow(date, timeZone) ?? { startAt: `${date}T00:00:00.000Z`, endAt: `${date}T23:59:59.999Z` };
}

export function resolvePickupStatus(
  appointment: Pick<Appointment, 'status' | 'startAt' | 'timezone'>,
  organizationToday: LocalDate,
): CremainsPickupStatus {
  if (appointment.status === 'completed') return 'received';
  const expected = expectedDateOf(appointment);
  if (expected && isPickupOverdue({ expectedPickupDate: expected, receivedOn: null, organizationToday })) {
    return 'overdue';
  }
  return appointment.status === 'confirmed' ? 'confirmed' : 'estimated';
}

/**
 * Whether an existing pickup was decided by a human rather than computed.
 *
 * `lastModifiedBy` is null on an automatically created appointment and set
 * by every staff edit; a `confirmed` status is itself a human decision
 * about that specific date. Uses fields the Appointment already has — no
 * extra flag, no extra column.
 */
export function isManuallyDecided(appointment: Pick<Appointment, 'status' | 'lastModifiedBy'>): boolean {
  return appointment.lastModifiedBy !== null || appointment.status === 'confirmed';
}
