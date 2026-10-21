import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  businessDaysBetween,
  effectiveStartDate,
  isBusinessDay,
  localDateTime,
  nextBusinessDay,
  parseClockTime,
  toLocalDate,
  type BusinessCalendar,
} from './businessCalendar';

const NY = 'America/New_York';
const calendar = (holidays: string[] = []): BusinessCalendar => ({ timezone: NY, closingMinutes: 17 * 60, cutoffMinutes: 17 * 60, holidays: new Set(holidays) });

describe('business days (America/New_York, Monday–Friday)', () => {
  it('Monday–Friday are business days; Saturday and Sunday are not', () => {
    // 2026-10-19 is a Monday.
    expect(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'].every((d) => isBusinessDay(d, calendar()))).toBe(true);
    expect(isBusinessDay('2026-10-24', calendar())).toBe(false);
    expect(isBusinessDay('2026-10-25', calendar())).toBe(false);
  });

  it('a Friday deadline plus one business day lands on Monday', () => {
    expect(nextBusinessDay('2026-10-23', calendar())).toBe('2026-10-26');
    expect(addBusinessDays('2026-10-22', 2, calendar())).toBe('2026-10-26');
    expect(businessDaysBetween('2026-10-23', '2026-10-26', calendar())).toBe(1);
    expect(businessDaysBetween('2026-10-26', '2026-10-23', calendar())).toBe(-1);
  });

  it('configured holidays are skipped', () => {
    const thanksgiving = calendar(['2026-11-26', '2026-11-27']);
    expect(addBusinessDays('2026-11-25', 1, thanksgiving)).toBe('2026-11-30');
    expect(businessDaysBetween('2026-11-25', '2026-11-30', thanksgiving)).toBe(1);
  });

  it('a weekend event counts from Monday', () => {
    expect(effectiveStartDate({ date: '2026-10-24', minutes: 600 }, calendar(), true)).toBe('2026-10-26');
  });

  it('an event at or after the cutoff counts from the next business day — when the policy applies it', () => {
    expect(effectiveStartDate({ date: '2026-10-20', minutes: 16 * 60 + 59 }, calendar(), true)).toBe('2026-10-20');
    expect(effectiveStartDate({ date: '2026-10-20', minutes: 17 * 60 }, calendar(), true)).toBe('2026-10-21');
    expect(effectiveStartDate({ date: '2026-10-23', minutes: 18 * 60 }, calendar(), true)).toBe('2026-10-26');
    expect(effectiveStartDate({ date: '2026-10-20', minutes: 18 * 60 }, calendar(), false)).toBe('2026-10-20');
    // A date-only event has no time of day, so no cutoff applies.
    expect(effectiveStartDate({ date: '2026-10-20', minutes: null }, calendar(), true)).toBe('2026-10-20');
  });

  it('local dates and times come from the timezone, never the server clock', () => {
    // 21:30 UTC on Oct 20 is 17:30 in New York (EDT, UTC-4).
    expect(localDateTime('2026-10-20T21:30:00.000Z', NY)).toEqual({ date: '2026-10-20', minutes: 17 * 60 + 30 });
    // 02:00 UTC on Oct 21 is still Oct 20 in New York.
    expect(localDateTime('2026-10-21T02:00:00.000Z', NY)?.date).toBe('2026-10-20');
  });

  it('daylight saving changes never shift a date', () => {
    // DST ends Sunday 2026-11-01 (EDT → EST).
    expect(localDateTime('2026-10-30T20:00:00.000Z', NY)).toEqual({ date: '2026-10-30', minutes: 16 * 60 });
    expect(localDateTime('2026-11-02T21:00:00.000Z', NY)).toEqual({ date: '2026-11-02', minutes: 16 * 60 });
    expect(addBusinessDays('2026-10-30', 1, calendar())).toBe('2026-11-02');
    // DST starts Sunday 2026-03-08 (EST → EDT).
    expect(addBusinessDays('2026-03-06', 2, calendar())).toBe('2026-03-10');
    expect(businessDaysBetween('2026-03-06', '2026-03-10', calendar())).toBe(2);
  });

  it('parses stored dates and clock times strictly', () => {
    expect(toLocalDate('10/20/2026')).toBe('2026-10-20');
    expect(toLocalDate('2026-10-20')).toBe('2026-10-20');
    expect(toLocalDate('02/30/2026')).toBeNull();
    expect(toLocalDate('')).toBeNull();
    expect(parseClockTime('17:00')).toBe(1020);
    expect(parseClockTime('5pm')).toBeNull();
  });
});
