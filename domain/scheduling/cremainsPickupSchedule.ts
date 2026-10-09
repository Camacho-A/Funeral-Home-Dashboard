/**
 * Expected Cremains Pickup scheduling (2026-10). The pure calendar
 * arithmetic behind "when should we expect this case's cremains back?".
 *
 * THE RULE
 *
 *   1. Start from the organization-local calendar date on which the
 *      crematory paperwork was actually completed.
 *   2. Add `minimumProcessingDays` CALENDAR days (default 7) — not
 *      business days.
 *   3. Take the first allowed pickup weekday ON OR AFTER that date, so a
 *      minimum that already lands on a pickup day is used as-is rather
 *      than pushed to the next one.
 *
 * WHY THE ARITHMETIC LOOKS LIKE THIS
 *
 * A pickup date is a CALENDAR date, not an instant. Adding 7 × 24 hours to
 * a timestamp and reading the result's UTC date is wrong twice over: it
 * silently shifts across a daylight-saving boundary, and it reports a UTC
 * day that can be a different calendar day than the organization's own.
 *
 * So this works in two deliberate steps:
 *   - `Intl.DateTimeFormat` with the organization's IANA timezone extracts
 *     the year/month/day the organization itself was experiencing at that
 *     instant. This is the ONLY timezone-aware step, and it matches how
 *     `utils/inputMask.ts#resolveOrgLocalToday` and
 *     `domain/cases/caseNumber.ts#orgLocalYear` already resolve an
 *     organization's local calendar day.
 *   - Everything after that is pure calendar arithmetic on a UTC-anchored
 *     date, a timezone-free space where "add a day" always means exactly
 *     one calendar day. Month ends, year ends, leap days and DST
 *     transitions all fall out correctly because no wall-clock offset is
 *     ever involved.
 *
 * Nothing here reads a clock, touches a case, or knows which organization
 * it is working for — the caller supplies the configuration (see
 * domain/organization/cremainsPickupCapability.ts).
 */

/** `Date.getUTCDay()` convention: 0 Sunday … 6 Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

/** Manors picks up on Tuesdays and Fridays. A default, never a hardcoded
    rule — every caller may override it per organization. */
export const DEFAULT_PICKUP_WEEKDAYS: readonly Weekday[] = [2, 5];

/** Seven calendar days between paperwork and the earliest pickup. */
export const DEFAULT_MINIMUM_PROCESSING_DAYS = 7;

/** An organization-local calendar date, `YYYY-MM-DD`. Deliberately a
    plain date string rather than a `Date`: it carries no instant, no
    offset, and no host-timezone interpretation. */
export type LocalDate = string;

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  // Reject an impossible calendar date (2026-02-30, 2026-13-01) rather
  // than letting Date silently roll it into the next period.
  const anchored = anchorUtc(Number(year), Number(month), Number(day));
  return (
    anchored.getUTCFullYear() === Number(year) &&
    anchored.getUTCMonth() === Number(month) - 1 &&
    anchored.getUTCDate() === Number(day)
  );
}

/** A timezone-free calendar anchor. UTC is used purely as a neutral
    coordinate space — this value never represents a real instant. */
function anchorUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function formatLocalDate(anchored: Date): LocalDate {
  const year = String(anchored.getUTCFullYear()).padStart(4, '0');
  const month = String(anchored.getUTCMonth() + 1).padStart(2, '0');
  const day = String(anchored.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseLocalDate(value: LocalDate): Date | null {
  if (!isLocalDate(value)) return null;
  const [, year, month, day] = LOCAL_DATE_PATTERN.exec(value)!;
  return anchorUtc(Number(year), Number(month), Number(day));
}

/**
 * The organization's own calendar date at a given instant.
 *
 * This is the single timezone-aware operation in this module. An absent or
 * unrecognized timezone falls back to UTC, matching `orgLocalYear`'s and
 * `resolveOrgLocalToday`'s existing behavior — never a fixed numeric
 * offset, which would be wrong half the year.
 */
export function organizationLocalDate(instantIso: string, timezone: string | undefined): LocalDate | null {
  const instant = new Date(instantIso);
  if (Number.isNaN(instant.getTime())) return null;

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: timezone || 'UTC',
    }).formatToParts(instant);
  } catch {
    // An invalid IANA name must not throw into a case save — fall back to
    // UTC, the same safe default the existing helpers use.
    parts = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC',
    }).formatToParts(instant);
  }

  const lookup = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = lookup('year');
  const month = lookup('month');
  const day = lookup('day');
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

/** The weekday of an organization-local calendar date. */
export function weekdayOf(date: LocalDate): Weekday | null {
  const anchored = parseLocalDate(date);
  return anchored ? (anchored.getUTCDay() as Weekday) : null;
}

export function addCalendarDays(date: LocalDate, days: number): LocalDate | null {
  const anchored = parseLocalDate(date);
  if (!anchored) return null;
  anchored.setUTCDate(anchored.getUTCDate() + days);
  return formatLocalDate(anchored);
}

/**
 * How far the given timezone's wall clock is from UTC at an instant, in
 * milliseconds (negative west of Greenwich).
 *
 * Measured with `Intl` at that specific instant, so it is correct on both
 * sides of a daylight-saving transition — never a fixed offset.
 */
function timezoneOffsetMs(instantMs: number, timeZone: string): number {
  // Measured on a whole-second instant: `Intl` has no millisecond part, so
  // reconstructing `asIfUtc` from its output would otherwise silently drop
  // any sub-second component into the offset — which compounded into a
  // ~1s drift and pushed an end-of-day anchor into the NEXT day.
  const whole = Math.floor(instantMs / 1000) * 1000;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(whole));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asIfUtc - whole;
}

/**
 * The real instant at which a given wall-clock time occurs in a timezone.
 *
 * Needed because an all-day event anchored at UTC midnight renders as the
 * PREVIOUS evening anywhere west of Greenwich — which both displays an
 * invented time and can show the pickup on the wrong day. Caught in visual
 * verification: a Florida pickup rendered as "8:00 PM" the day before.
 *
 * Two passes: measure the offset at the naive guess, correct, then
 * re-measure in case the correction crossed a DST boundary.
 */
export function zonedInstant(
  date: LocalDate,
  wallClock: { hour: number; minute: number; second: number; ms: number },
  timeZone: string | undefined,
): string | null {
  const anchored = parseLocalDate(date);
  if (!anchored) return null;
  const naive = Date.UTC(
    anchored.getUTCFullYear(),
    anchored.getUTCMonth(),
    anchored.getUTCDate(),
    wallClock.hour,
    wallClock.minute,
    wallClock.second,
    wallClock.ms,
  );
  const zone = timeZone || 'UTC';
  try {
    let instant = naive - timezoneOffsetMs(naive, zone);
    const corrected = naive - timezoneOffsetMs(instant, zone);
    if (corrected !== instant) instant = corrected;
    return new Date(instant).toISOString();
  } catch {
    return new Date(naive).toISOString();
  }
}

/** The instant range covering one whole organization-local calendar day. */
export function localAllDayWindow(date: LocalDate, timeZone: string | undefined): { startAt: string; endAt: string } | null {
  const startAt = zonedInstant(date, { hour: 0, minute: 0, second: 0, ms: 0 }, timeZone);
  const endAt = zonedInstant(date, { hour: 23, minute: 59, second: 59, ms: 999 }, timeZone);
  return startAt && endAt ? { startAt, endAt } : null;
}

export type ExpectedPickupInput = {
  /** The organization-local calendar date the crematory paperwork was
      completed. Use `organizationLocalDate()` to derive this from the
      completion instant. */
  paperworkCompletedOn: LocalDate;
  minimumProcessingDays?: number;
  allowedPickupWeekdays?: readonly Weekday[];
};

/**
 * The expected pickup date, or null when the inputs cannot produce one.
 *
 * Returns null rather than guessing when the paperwork date is malformed,
 * the minimum is negative/non-integer, or no pickup weekday is allowed —
 * the caller then simply schedules nothing, which is always safer than
 * inventing a date for a funeral record.
 */
export function calculateExpectedPickupDate(input: ExpectedPickupInput): LocalDate | null {
  const {
    paperworkCompletedOn,
    minimumProcessingDays = DEFAULT_MINIMUM_PROCESSING_DAYS,
    allowedPickupWeekdays = DEFAULT_PICKUP_WEEKDAYS,
  } = input;

  if (!isLocalDate(paperworkCompletedOn)) return null;
  if (!Number.isInteger(minimumProcessingDays) || minimumProcessingDays < 0) return null;

  const allowed = new Set(allowedPickupWeekdays);
  if (allowed.size === 0) return null;

  const earliest = addCalendarDays(paperworkCompletedOn, minimumProcessingDays);
  if (!earliest) return null;

  // On or after: an earliest date that is itself an allowed pickup day is
  // used unchanged. Bounded at 7 — one full week always contains every
  // weekday, so a non-empty allowed set can never fail to match.
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addCalendarDays(earliest, offset);
    if (!candidate) return null;
    const weekday = weekdayOf(candidate);
    if (weekday !== null && allowed.has(weekday)) return candidate;
  }
  return null;
}

/**
 * Convenience wrapper for the common caller shape: an ISO completion
 * instant plus the organization's timezone and configuration.
 */
export function calculateExpectedPickupDateFromInstant(params: {
  paperworkCompletedAt: string;
  timezone: string | undefined;
  minimumProcessingDays?: number;
  allowedPickupWeekdays?: readonly Weekday[];
}): LocalDate | null {
  const paperworkCompletedOn = organizationLocalDate(params.paperworkCompletedAt, params.timezone);
  if (!paperworkCompletedOn) return null;
  return calculateExpectedPickupDate({
    paperworkCompletedOn,
    minimumProcessingDays: params.minimumProcessingDays,
    allowedPickupWeekdays: params.allowedPickupWeekdays,
  });
}

/**
 * Whether an expected pickup is overdue as of the organization's own
 * today.
 *
 * OVERDUE is DERIVED, never persisted — it is a pure function of the
 * expected date and whether the cremains have been received, so it can
 * never drift out of sync with them, and the passage of a date can never
 * by itself mutate a record (see the service's own note on this).
 */
export function isPickupOverdue(params: {
  expectedPickupDate: LocalDate;
  receivedOn: LocalDate | null;
  organizationToday: LocalDate;
}): boolean {
  if (params.receivedOn) return false;
  if (!isLocalDate(params.expectedPickupDate) || !isLocalDate(params.organizationToday)) return false;
  return params.expectedPickupDate < params.organizationToday;
}
