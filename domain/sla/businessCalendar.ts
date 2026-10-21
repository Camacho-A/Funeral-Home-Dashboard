/**
 * Business-day calendar for SLA tracking (2026-10).
 *
 * Every calculation works on LOCAL calendar dates (YYYY-MM-DD) in the
 * organization's timezone, never on elapsed milliseconds, so a daylight
 * saving change can never move a deadline by a day. Monday to Friday are
 * business days, minus configured holidays.
 *
 * Pure: "now" is always passed in.
 */

export type LocalDate = string; // YYYY-MM-DD

export type BusinessCalendar = {
  timezone: string;
  /** Minutes after local midnight at which the business day closes. */
  closingMinutes: number;
  /** Minutes after local midnight from which an event counts as arriving
      the next business day (where the milestone's policy allows it). */
  cutoffMinutes: number;
  holidays: ReadonlySet<LocalDate>;
};

/** "17:00" → 1020. Returns null for anything that is not a valid HH:MM. */
export function parseClockTime(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** The local calendar date and time of day of an instant. */
export function localDateTime(iso: string, timezone: string): { date: LocalDate; minutes: number } | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** A stored date-only value (MM/DD/YYYY or YYYY-MM-DD) as a LocalDate. */
export function toLocalDate(value: string | null | undefined): LocalDate | null {
  const trimmed = value?.trim() ?? '';
  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const [year, month, day] = us ? [us[3], us[1], us[2]] : iso ? [iso[1], iso[2], iso[3]] : [];
  if (!year) return null;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return `${year}-${month}-${day}`;
}

function toUtc(date: LocalDate): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUtc(date: Date): LocalDate {
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(date: LocalDate, days: number): LocalDate {
  const next = toUtc(date);
  next.setUTCDate(next.getUTCDate() + days);
  return fromUtc(next);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: LocalDate): number {
  return toUtc(date).getUTCDay();
}

export function isBusinessDay(date: LocalDate, calendar: Pick<BusinessCalendar, 'holidays'>): boolean {
  const weekday = weekdayOf(date);
  return weekday !== 0 && weekday !== 6 && !calendar.holidays.has(date);
}

/** The first business day strictly after `date`. */
export function nextBusinessDay(date: LocalDate, calendar: Pick<BusinessCalendar, 'holidays'>): LocalDate {
  let next = addCalendarDays(date, 1);
  while (!isBusinessDay(next, calendar)) next = addCalendarDays(next, 1);
  return next;
}

/** `date` itself when it is a business day, otherwise the next one. */
export function onOrNextBusinessDay(date: LocalDate, calendar: Pick<BusinessCalendar, 'holidays'>): LocalDate {
  return isBusinessDay(date, calendar) ? date : nextBusinessDay(date, calendar);
}

/** `days` business days after `date` (0 → `date` itself). */
export function addBusinessDays(date: LocalDate, days: number, calendar: Pick<BusinessCalendar, 'holidays'>): LocalDate {
  let current = date;
  for (let i = 0; i < days; i++) current = nextBusinessDay(current, calendar);
  return current;
}

/**
 * Business days from `from` to `to`: the number of business days after
 * `from` up to and including `to`. Negative when `to` is before `from`.
 * Equal dates → 0.
 */
export function businessDaysBetween(from: LocalDate, to: LocalDate, calendar: Pick<BusinessCalendar, 'holidays'>): number {
  if (from === to) return 0;
  const forward = from < to;
  const end = forward ? to : from;
  let cursor = forward ? from : to;
  let count = 0;
  while (cursor < end) {
    cursor = addCalendarDays(cursor, 1);
    if (isBusinessDay(cursor, calendar)) count += 1;
  }
  return forward ? count : -count;
}

/**
 * The business day an event counts from. An event on a weekend or holiday,
 * or — when the policy applies the cutoff — at or after the after-hours
 * cutoff, counts from the next business day. A date-only event (no time
 * of day) counts from its own date when that is a business day.
 */
export function effectiveStartDate(
  event: { date: LocalDate; minutes: number | null },
  calendar: BusinessCalendar,
  applyCutoff: boolean,
): LocalDate {
  if (!isBusinessDay(event.date, calendar)) return nextBusinessDay(event.date, calendar);
  if (applyCutoff && event.minutes !== null && event.minutes >= calendar.cutoffMinutes) return nextBusinessDay(event.date, calendar);
  return event.date;
}
