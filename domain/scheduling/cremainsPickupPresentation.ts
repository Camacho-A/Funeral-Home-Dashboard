import type { Appointment } from '../../types/appointment';
import { APPOINTMENT_TYPES } from './appointmentTypeRegistry';
import { isPickupOverdue, localAllDayWindow, organizationLocalDate, type LocalDate } from './cremainsPickupSchedule';
import { parseCaseNumber } from '../cases/caseNumber';
import { toDisplayTitleCase } from '../../utils/string';

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


/**
 * Calendar labelling for an expected cremains pickup (2026-10).
 *
 * A stored title reads "Expected Cremains Pickup — B2026-035", and the
 * deceased's name is separate again — far too long for a month cell. What
 * staff actually scan for is which case, so a chip reads:
 *
 *   B2026-035 · Rivero        (full)
 *   035 · Rivero              (compact, in tight cells)
 *
 * Presentation only: no stored title is ever rewritten.
 */

/**
 * Name particles that belong to the surname rather than preceding it.
 *
 * The naive "last word of the string" rule breaks real families — it turns
 * "Robert van der Berg" into "Berg" and "Maria De La Cruz" into "Cruz".
 * Walking backwards and absorbing these keeps a compound surname whole.
 */
const SURNAME_PARTICLES = new Set([
  'van', 'von', 'der', 'den', 'de', 'del', 'della', 'di', 'da', 'dos', 'das',
  'la', 'le', 'du', 'ter', 'ten', 'af', 'av', 'bin', 'ibn', 'al', 'st', 'st.',
]);

/** Generational and professional suffixes, which are never the surname. */
const NAME_SUFFIXES = new Set([
  'jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v', 'md', 'm.d.', 'phd', 'ph.d.', 'esq', 'esq.', 'dds',
]);

/**
 * The surname from a stored full name.
 *
 * Deliberately NOT "the last word": suffixes are dropped and compound
 * particles are absorbed, so "Robert van der Berg" yields "van der Berg"
 * and "Evarista Silva Rivero" yields "Rivero" (the maternal surname is a
 * separate word, not a particle, so only the final element is taken —
 * matching how these names are referred to day to day).
 *
 * Returns null for an empty or unusable name rather than a guess.
 */
export function deriveSurname(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && NAME_SUFFIXES.has(words[words.length - 1].toLowerCase().replace(/,$/, ''))) {
    words.pop();
  }
  if (words.length === 0) return null;
  if (words.length === 1) return toDisplayTitleCase(words[0]);

  const parts = [words[words.length - 1]];
  let index = words.length - 2;
  // Absorb particles, but never consume the entire name.
  while (index > 0 && SURNAME_PARTICLES.has(words[index].toLowerCase())) {
    parts.unshift(words[index]);
    index -= 1;
  }
  return toDisplayTitleCase(parts.join(' '));
}

/**
 * The sequence portion of a case number ("B2026-035" -> "035"), for cells
 * too tight for the whole thing. Falls back to the full value rather than
 * inventing a shortened form it cannot parse.
 */
export function compactCaseNumber(caseNumber: string): string {
  const parsed = parseCaseNumber(caseNumber);
  if (!parsed) return caseNumber;
  return String(parsed.sequence).padStart(3, '0');
}

/**
 * The chip label for a pickup.
 *
 * `caseNumber`/`decedentName` must come from the caller's own
 * organization-scoped case lookup. When the case is absent — unauthorized,
 * deleted, or simply not in the loaded window — this falls back to a
 * neutral label and NEVER invents or substitutes a case number.
 */
export function cremainsChipLabel(
  case_: { caseNumber: string; decedentName: string } | null | undefined,
  options: { compact?: boolean } = {},
): string {
  if (!case_?.caseNumber) return 'Cremains Pickup';
  const number = options.compact ? compactCaseNumber(case_.caseNumber) : case_.caseNumber;
  const surname = deriveSurname(case_.decedentName);
  return surname ? `${number} · ${surname}` : number;
}

/** Formats `YYYY-MM-DD` as a calendar date, with no timezone conversion —
    the string is already the organization's own local date. */
export function formatPickupDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Same calendar date without the weekday — used where the weekday is
    already named in the surrounding sentence. */
export function formatPickupDateShort(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The paperwork date the automation recorded when it scheduled a pickup.
    Null for a staff-entered one, which asserts no paperwork date at all —
    callers show "Not recorded" rather than guessing. */
export function paperworkDateFromNotes(notes: string | null): string | null {
  if (!notes) return null;
  if (!/COMPLETED CREMATORY PAPERWORK/i.test(notes)) return null;
  const match = /(\d{4}-\d{2}-\d{2})/.exec(notes);
  return match ? match[1] : null;
}
