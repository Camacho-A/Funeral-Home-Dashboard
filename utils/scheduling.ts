/**
 * Phase 27 (Scheduling & Resource Management). Calendar-grid date math and
 * timezone-aware time formatting, hand-rolled against native `Date`/
 * `Intl.DateTimeFormat` — no new date-library dependency, per the approved
 * plan's explicit decision (this codebase's bounded Day/Week/Month/Agenda
 * view set doesn't justify one). `utils/format.ts`'s existing
 * `formatTimestamp` ignores timezone entirely and must not be reused for
 * appointment times, which always carry their own `timezone` field.
 */

export function formatAppointmentTime(isoString: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(isoString));
}

export function formatAppointmentDate(isoString: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: timezone }).format(new Date(isoString));
}

export function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Sunday-anchored week start, matching `Date.getDay()`'s own 0=Sunday convention. */
export function startOfWeek(date: Date): Date {
  return addDays(startOfDay(date), -date.getDay());
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** A fixed 6x7 grid (42 days) starting from the Sunday on/before the 1st of
    the month and running through however many trailing days are needed to
    fill the last row — the standard month-calendar-grid shape. */
export function getMonthGridDays(anchor: Date): Date[] {
  const firstOfMonth = startOfMonth(anchor);
  const gridStart = startOfWeek(firstOfMonth);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export function getWeekDays(anchor: Date): Date[] {
  const weekStart = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export const WEEKDAY_LABELS: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type CalendarView = 'day' | 'week' | 'month' | 'agenda';

/** The one query range every view is a pure projection of — Day/Week/Month
    bound the query to exactly what's rendered; Agenda uses a rolling
    90-day window from the anchor date (no keyset pagination exists for
    appointments, unlike the Activity timeline, so a bounded window is the
    simplest correct choice for this phase). */
export function getCalendarRange(view: CalendarView, anchor: Date): { from: string; to: string } {
  if (view === 'day') {
    return { from: startOfDay(anchor).toISOString(), to: addDays(startOfDay(anchor), 1).toISOString() };
  }
  if (view === 'week') {
    const start = startOfWeek(anchor);
    return { from: start.toISOString(), to: addDays(start, 7).toISOString() };
  }
  if (view === 'month') {
    const days = getMonthGridDays(anchor);
    return { from: days[0].toISOString(), to: addDays(days[days.length - 1], 1).toISOString() };
  }
  return { from: startOfDay(anchor).toISOString(), to: addDays(startOfDay(anchor), 90).toISOString() };
}
