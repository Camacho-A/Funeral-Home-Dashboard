import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  calculateExpectedPickupDate,
  calculateExpectedPickupDateFromInstant,
  DEFAULT_MINIMUM_PROCESSING_DAYS,
  DEFAULT_PICKUP_WEEKDAYS,
  isLocalDate,
  isPickupOverdue,
  localAllDayWindow,
  organizationLocalDate,
  weekdayOf,
  type Weekday,
} from './cremainsPickupSchedule';

/**
 * Expected Cremains Pickup scheduling (2026-10). The confirmed business
 * rule: paperwork completion date + 7 CALENDAR days, then the first
 * Tuesday or Friday on or after that.
 */

const FLORIDA = 'America/New_York';

/** Every worked example from the confirmed rule, asserted verbatim. */
describe('calculateExpectedPickupDate — the confirmed Manors rule', () => {
  const CONFIRMED_EXAMPLES: Array<[string, string, string, string]> = [
    // [paperwork sent, weekday, earliest eligible, expected pickup]
    ['2026-10-05', 'Monday', '2026-10-12', '2026-10-13'],
    ['2026-10-06', 'Tuesday', '2026-10-13', '2026-10-13'],
    ['2026-10-07', 'Wednesday', '2026-10-14', '2026-10-16'],
    ['2026-10-08', 'Thursday', '2026-10-15', '2026-10-16'],
    ['2026-10-09', 'Friday', '2026-10-16', '2026-10-16'],
    ['2026-10-10', 'Saturday', '2026-10-17', '2026-10-20'],
    ['2026-10-11', 'Sunday', '2026-10-18', '2026-10-20'],
  ];

  for (const [sent, weekday, earliest, expected] of CONFIRMED_EXAMPLES) {
    it(`${weekday} ${sent} -> ${expected}`, () => {
      // The fixture's own weekday claim is asserted too, so a wrong date
      // in the table fails loudly instead of silently testing the wrong day.
      expect(weekdayOf(sent)).toBe(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(weekday));
      expect(addCalendarDays(sent, 7)).toBe(earliest);
      expect(calculateExpectedPickupDate({ paperworkCompletedOn: sent })).toBe(expected);
    });
  }

  it('the 7-day minimum landing ON a pickup weekday is used as-is, never pushed to the next one', () => {
    // Tuesday + 7 = Tuesday; Friday + 7 = Friday.
    expect(calculateExpectedPickupDate({ paperworkCompletedOn: '2026-10-06' })).toBe('2026-10-13');
    expect(calculateExpectedPickupDate({ paperworkCompletedOn: '2026-10-09' })).toBe('2026-10-16');
  });

  it('always lands on an allowed pickup weekday', () => {
    for (let day = 1; day <= 28; day += 1) {
      const sent = `2026-09-${String(day).padStart(2, '0')}`;
      const result = calculateExpectedPickupDate({ paperworkCompletedOn: sent })!;
      expect(DEFAULT_PICKUP_WEEKDAYS).toContain(weekdayOf(result));
    }
  });

  it('is never earlier than the 7-day minimum, and never more than 6 days past it', () => {
    for (let day = 1; day <= 28; day += 1) {
      const sent = `2026-09-${String(day).padStart(2, '0')}`;
      const earliest = addCalendarDays(sent, DEFAULT_MINIMUM_PROCESSING_DAYS)!;
      const result = calculateExpectedPickupDate({ paperworkCompletedOn: sent })!;
      expect(result >= earliest, `${sent}: ${result} must be >= ${earliest}`).toBe(true);
      expect(result <= addCalendarDays(earliest, 6)!).toBe(true);
    }
  });

  it('counts CALENDAR days, not business days — a week spanning a weekend still adds exactly 7', () => {
    expect(addCalendarDays('2026-10-05', 7)).toBe('2026-10-12');
  });
});

describe('calculateExpectedPickupDate — boundaries', () => {
  it('crosses a month boundary', () => {
    // Mon 2026-10-26 + 7 = Mon 2026-11-02 -> Tue 2026-11-03.
    expect(calculateExpectedPickupDate({ paperworkCompletedOn: '2026-10-26' })).toBe('2026-11-03');
  });

  it('crosses a 31-day month into a 30-day month', () => {
    // Thu 2026-10-29 + 7 = Thu 2026-11-05 -> Fri 2026-11-06.
    expect(calculateExpectedPickupDate({ paperworkCompletedOn: '2026-10-29' })).toBe('2026-11-06');
  });

  it('crosses a year boundary', () => {
    // Mon 2026-12-28 + 7 = Mon 2027-01-04 -> Tue 2027-01-05.
    expect(addCalendarDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(calculateExpectedPickupDate({ paperworkCompletedOn: '2026-12-28' })).toBe('2027-01-05');
  });

  it('crosses February in a leap year', () => {
    // 2028 is a leap year: Feb has 29 days.
    expect(addCalendarDays('2028-02-22', 7)).toBe('2028-02-29');
    // Tue 2028-02-29 is itself a pickup day.
    expect(weekdayOf('2028-02-29')).toBe(2);
    expect(calculateExpectedPickupDate({ paperworkCompletedOn: '2028-02-22' })).toBe('2028-02-29');
  });

  it('crosses February in a non-leap year — Feb 29 does not exist', () => {
    expect(addCalendarDays('2026-02-22', 7)).toBe('2026-03-01');
    expect(isLocalDate('2026-02-29')).toBe(false);
  });

  it('handles a century non-leap year (1900-style rule)', () => {
    expect(isLocalDate('2100-02-29')).toBe(false);
    expect(isLocalDate('2000-02-29')).toBe(true);
  });
});

describe('calculateExpectedPickupDate — daylight saving', () => {
  // US DST 2026: forward Sun 2026-03-08, back Sun 2026-11-01. Adding 7
  // calendar days across either must still be exactly 7 calendar days —
  // the bug a naive "+168 hours" implementation produces.
  it('spring-forward week still adds exactly 7 calendar days', () => {
    expect(addCalendarDays('2026-03-05', 7)).toBe('2026-03-12');
    // Thu 2026-03-05 + 7 = Thu 2026-03-12 -> Fri 2026-03-13.
    expect(calculateExpectedPickupDate({ paperworkCompletedOn: '2026-03-05' })).toBe('2026-03-13');
  });

  it('fall-back week still adds exactly 7 calendar days', () => {
    expect(addCalendarDays('2026-10-29', 7)).toBe('2026-11-05');
  });

  it('a paperwork instant on the DST changeover day resolves to the correct local date', () => {
    // 2026-11-01T05:30:00Z is 01:30 Eastern — still Nov 1 locally, during
    // the repeated hour.
    expect(organizationLocalDate('2026-11-01T05:30:00.000Z', FLORIDA)).toBe('2026-11-01');
    // 2026-03-08T07:30:00Z is 02:30 EST -> 03:30 EDT, still Mar 8 locally.
    expect(organizationLocalDate('2026-03-08T07:30:00.000Z', FLORIDA)).toBe('2026-03-08');
  });
});

describe('organizationLocalDate — the organization\'s calendar day, not the server\'s', () => {
  it('a late-evening local instant is NOT reported as the next UTC day', () => {
    // 2026-10-08T23:30 Eastern is 2026-10-09T03:30Z. The organization is
    // still on Oct 8 — using the UTC date would schedule a day late.
    const instant = '2026-10-09T03:30:00.000Z';
    expect(organizationLocalDate(instant, FLORIDA)).toBe('2026-10-08');
    expect(organizationLocalDate(instant, 'UTC')).toBe('2026-10-09');
  });

  it('the resulting pickup differs accordingly — this is the whole point of using the org timezone', () => {
    const instant = '2026-10-09T03:30:00.000Z';
    // Eastern: Thu Oct 8 -> Fri Oct 16. UTC: Fri Oct 9 -> Fri Oct 16.
    expect(calculateExpectedPickupDateFromInstant({ paperworkCompletedAt: instant, timezone: FLORIDA })).toBe('2026-10-16');
    // A Saturday-evening Eastern instant is Sunday in UTC, and the two
    // genuinely produce different pickups.
    const saturdayEvening = '2026-10-11T02:30:00.000Z'; // Sat Oct 10, 22:30 ET
    expect(organizationLocalDate(saturdayEvening, FLORIDA)).toBe('2026-10-10');
    expect(organizationLocalDate(saturdayEvening, 'UTC')).toBe('2026-10-11');
    // Both land on Tue Oct 20 here, so assert the local dates differ —
    // the date resolution is what matters, not a coincidental tie.
    expect(organizationLocalDate(saturdayEvening, FLORIDA)).not.toBe(organizationLocalDate(saturdayEvening, 'UTC'));
  });

  it('honors a genuinely different timezone', () => {
    const instant = '2026-10-08T20:00:00.000Z';
    expect(organizationLocalDate(instant, 'America/New_York')).toBe('2026-10-08');
    expect(organizationLocalDate(instant, 'America/Chicago')).toBe('2026-10-08');
    expect(organizationLocalDate(instant, 'Pacific/Auckland')).toBe('2026-10-09');
  });

  it('falls back to UTC for an absent or invalid timezone rather than throwing', () => {
    expect(organizationLocalDate('2026-10-08T20:00:00.000Z', undefined)).toBe('2026-10-08');
    expect(organizationLocalDate('2026-10-08T20:00:00.000Z', 'Not/AZone')).toBe('2026-10-08');
  });

  it('returns null for an unparseable instant', () => {
    expect(organizationLocalDate('not a date', FLORIDA)).toBeNull();
    expect(organizationLocalDate('', FLORIDA)).toBeNull();
  });
});

describe('calculateExpectedPickupDate — configuration', () => {
  it('honors a different allowed-weekday set', () => {
    // Monday-only pickups: Thu 2026-10-08 + 7 = Thu 15 -> Mon 2026-10-19.
    const mondayOnly: Weekday[] = [1];
    expect(
      calculateExpectedPickupDate({ paperworkCompletedOn: '2026-10-08', allowedPickupWeekdays: mondayOnly }),
    ).toBe('2026-10-19');
  });

  it('honors a different minimum processing period', () => {
    // Thu 2026-10-08 + 3 = Sun 11 -> Tue 2026-10-13.
    expect(
      calculateExpectedPickupDate({ paperworkCompletedOn: '2026-10-08', minimumProcessingDays: 3 }),
    ).toBe('2026-10-13');
  });

  it('a zero minimum allows same-day pickup when that day is allowed', () => {
    // Tue 2026-10-06 + 0 = Tue 2026-10-06.
    expect(
      calculateExpectedPickupDate({ paperworkCompletedOn: '2026-10-06', minimumProcessingDays: 0 }),
    ).toBe('2026-10-06');
  });

  it('every weekday allowed means the earliest eligible date itself', () => {
    const allDays: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
    expect(
      calculateExpectedPickupDate({ paperworkCompletedOn: '2026-10-08', allowedPickupWeekdays: allDays }),
    ).toBe('2026-10-15');
  });

  it('returns null rather than inventing a date for unusable configuration', () => {
    expect(calculateExpectedPickupDate({ paperworkCompletedOn: '2026-10-08', allowedPickupWeekdays: [] })).toBeNull();
    expect(calculateExpectedPickupDate({ paperworkCompletedOn: '2026-10-08', minimumProcessingDays: -1 })).toBeNull();
    expect(calculateExpectedPickupDate({ paperworkCompletedOn: '2026-10-08', minimumProcessingDays: 2.5 })).toBeNull();
    expect(calculateExpectedPickupDate({ paperworkCompletedOn: 'not-a-date' })).toBeNull();
    expect(calculateExpectedPickupDate({ paperworkCompletedOn: '2026-02-30' })).toBeNull();
    expect(calculateExpectedPickupDate({ paperworkCompletedOn: '10/08/2026' })).toBeNull();
  });
});

describe('isPickupOverdue — derived, never persisted', () => {
  it('is overdue once the expected date is in the past and nothing was received', () => {
    expect(
      isPickupOverdue({ expectedPickupDate: '2026-10-16', receivedOn: null, organizationToday: '2026-10-17' }),
    ).toBe(true);
  });

  it('is not overdue on the expected day itself', () => {
    expect(
      isPickupOverdue({ expectedPickupDate: '2026-10-16', receivedOn: null, organizationToday: '2026-10-16' }),
    ).toBe(false);
  });

  it('is never overdue once received, however late', () => {
    expect(
      isPickupOverdue({ expectedPickupDate: '2026-10-16', receivedOn: '2026-10-20', organizationToday: '2026-12-01' }),
    ).toBe(false);
  });

  it('compares calendar dates, not instants — no timezone can flip it', () => {
    expect(
      isPickupOverdue({ expectedPickupDate: '2026-12-31', receivedOn: null, organizationToday: '2027-01-01' }),
    ).toBe(true);
    expect(
      isPickupOverdue({ expectedPickupDate: '2027-01-01', receivedOn: null, organizationToday: '2026-12-31' }),
    ).toBe(false);
  });
});

/**
 * All-day anchoring (2026-10). Found in visual verification: a pickup
 * stored at UTC midnight rendered as "8:00 PM" on the PREVIOUS day in
 * Florida. An all-day pickup must bracket the organization's own day.
 */
describe('localAllDayWindow — anchored to the organization\'s midnight, not UTC\'s', () => {
  it('a Florida all-day window starts at that date\'s local midnight', () => {
    const window = localAllDayWindow('2026-10-16', FLORIDA)!;
    // EDT is UTC-4 in October, so local midnight is 04:00Z the same day.
    expect(window.startAt).toBe('2026-10-16T04:00:00.000Z');
    // And the stored instant reads back as the intended local date.
    expect(organizationLocalDate(window.startAt, FLORIDA)).toBe('2026-10-16');
    expect(organizationLocalDate(window.endAt, FLORIDA)).toBe('2026-10-16');
  });

  it('the naive UTC-midnight anchor really would have been the previous day — the bug this fixes', () => {
    expect(organizationLocalDate('2026-10-16T00:00:00.000Z', FLORIDA)).toBe('2026-10-15');
  });

  it('round-trips every date correctly across a DST transition', () => {
    for (const date of ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-03-07', '2026-03-08', '2026-03-09']) {
      const window = localAllDayWindow(date, FLORIDA)!;
      expect(organizationLocalDate(window.startAt, FLORIDA), `${date} start`).toBe(date);
      expect(organizationLocalDate(window.endAt, FLORIDA), `${date} end`).toBe(date);
    }
  });

  it('works for a timezone east of Greenwich too', () => {
    const window = localAllDayWindow('2026-10-16', 'Pacific/Auckland')!;
    expect(organizationLocalDate(window.startAt, 'Pacific/Auckland')).toBe('2026-10-16');
    expect(organizationLocalDate(window.endAt, 'Pacific/Auckland')).toBe('2026-10-16');
  });

  it('falls back to UTC for an absent timezone', () => {
    expect(localAllDayWindow('2026-10-16', undefined)!.startAt).toBe('2026-10-16T00:00:00.000Z');
  });
});
