import { describe, expect, it } from 'vitest';
import {
  formatAppointmentTime,
  formatAppointmentDate,
  startOfDay,
  addDays,
  startOfWeek,
  startOfMonth,
  isSameDay,
  getMonthGridDays,
  getWeekDays,
  getCalendarRange,
} from './scheduling';

describe('formatAppointmentTime', () => {
  it('formats an ISO instant in the given timezone, not the host timezone', () => {
    // 2026-09-01T14:00:00.000Z is 9:00 AM in America/Chicago (UTC-5, daylight time) and 10:00 AM in America/New_York (UTC-4).
    expect(formatAppointmentTime('2026-09-01T14:00:00.000Z', 'America/Chicago')).toBe('9:00 AM');
    expect(formatAppointmentTime('2026-09-01T14:00:00.000Z', 'America/New_York')).toBe('10:00 AM');
  });
});

describe('formatAppointmentDate', () => {
  it('formats an ISO instant as a human date in the given timezone', () => {
    expect(formatAppointmentDate('2026-09-01T14:00:00.000Z', 'America/Chicago')).toBe('Sep 1, 2026');
  });
});

describe('startOfDay', () => {
  it('zeroes the time-of-day, preserving the calendar date', () => {
    const result = startOfDay(new Date(2026, 8, 15, 14, 30, 0));
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getDate()).toBe(15);
  });
});

describe('addDays', () => {
  it('adds a positive or negative number of days, rolling over month boundaries', () => {
    expect(addDays(new Date(2026, 8, 30), 1).getDate()).toBe(1);
    expect(addDays(new Date(2026, 8, 30), 1).getMonth()).toBe(9);
    expect(addDays(new Date(2026, 8, 1), -1).getMonth()).toBe(7);
  });
});

describe('startOfWeek', () => {
  it('returns the Sunday on or before the given date', () => {
    // 2026-09-16 is a Wednesday.
    const result = startOfWeek(new Date(2026, 8, 16));
    expect(result.getDay()).toBe(0);
    expect(result.getDate()).toBe(13);
  });
});

describe('startOfMonth', () => {
  it('returns the 1st of the given date\'s month', () => {
    const result = startOfMonth(new Date(2026, 8, 16));
    expect(result.getDate()).toBe(1);
    expect(result.getMonth()).toBe(8);
  });
});

describe('isSameDay', () => {
  it('is true for two Dates on the same calendar day regardless of time-of-day', () => {
    expect(isSameDay(new Date(2026, 8, 16, 1, 0), new Date(2026, 8, 16, 23, 0))).toBe(true);
  });

  it('is false across a day boundary', () => {
    expect(isSameDay(new Date(2026, 8, 16, 23, 59), new Date(2026, 8, 17, 0, 0))).toBe(false);
  });
});

describe('getMonthGridDays', () => {
  it('returns exactly 42 days (a fixed 6x7 grid) starting on a Sunday', () => {
    const days = getMonthGridDays(new Date(2026, 8, 16));
    expect(days).toHaveLength(42);
    expect(days[0].getDay()).toBe(0);
  });

  it('includes the 1st of the anchor month somewhere in the grid', () => {
    const days = getMonthGridDays(new Date(2026, 8, 16));
    expect(days.some((d) => d.getDate() === 1 && d.getMonth() === 8)).toBe(true);
  });
});

describe('getWeekDays', () => {
  it('returns exactly 7 days starting on Sunday', () => {
    const days = getWeekDays(new Date(2026, 8, 16));
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(0);
    expect(days[6].getDay()).toBe(6);
  });
});

describe('getCalendarRange', () => {
  it('day view bounds exactly [startOfDay, startOfDay + 1 day)', () => {
    const range = getCalendarRange('day', new Date(2026, 8, 16, 14, 0));
    const from = new Date(range.from);
    const to = new Date(range.to);
    expect(from.getHours()).toBe(0);
    expect((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)).toBe(1);
  });

  it('week view spans exactly 7 days', () => {
    const range = getCalendarRange('week', new Date(2026, 8, 16));
    expect((new Date(range.to).getTime() - new Date(range.from).getTime()) / (24 * 60 * 60 * 1000)).toBe(7);
  });

  it('month view spans exactly 42 days (the full grid)', () => {
    const range = getCalendarRange('month', new Date(2026, 8, 16));
    expect((new Date(range.to).getTime() - new Date(range.from).getTime()) / (24 * 60 * 60 * 1000)).toBe(42);
  });

  it('agenda view is a rolling 90-day window from the anchor date', () => {
    // Rounded rather than an exact ms/86400000 division — a DST transition
    // falling inside this 90-calendar-day window shifts the wall-clock UTC
    // offset by an hour without changing the calendar-day count itself.
    const range = getCalendarRange('agenda', new Date(2026, 8, 16));
    expect(Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / (24 * 60 * 60 * 1000))).toBe(90);
  });
});
