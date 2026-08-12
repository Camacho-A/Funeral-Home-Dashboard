import { describe, it, expect } from 'vitest';
import { orgLocalTime, isWithinQuietHours, hasDigestIntervalElapsed, isDigestGroupEligible, shouldDeferEmailForDigest } from './digestTiming';

describe('orgLocalTime', () => {
  it('formats HH:mm in the given timezone', () => {
    // 2026-08-01T14:30:00.000Z is 10:30 in America/New_York (EDT, UTC-4)
    expect(orgLocalTime('2026-08-01T14:30:00.000Z', 'America/New_York')).toBe('10:30');
  });

  it('falls back to UTC when timezone is unset', () => {
    expect(orgLocalTime('2026-08-01T14:30:00.000Z', undefined)).toBe('14:30');
  });

  it('formats midnight as 00:00, never 24:00', () => {
    expect(orgLocalTime('2026-08-01T00:00:00.000Z', 'UTC')).toBe('00:00');
  });
});

describe('isWithinQuietHours', () => {
  it('is false when either bound is unset', () => {
    expect(isWithinQuietHours('2026-08-01T23:00:00.000Z', 'UTC', null, '07:00')).toBe(false);
    expect(isWithinQuietHours('2026-08-01T23:00:00.000Z', 'UTC', '22:00', null)).toBe(false);
  });

  it('handles a same-day window (start <= end)', () => {
    expect(isWithinQuietHours('2026-08-01T14:00:00.000Z', 'UTC', '13:00', '15:00')).toBe(true);
    expect(isWithinQuietHours('2026-08-01T16:00:00.000Z', 'UTC', '13:00', '15:00')).toBe(false);
    expect(isWithinQuietHours('2026-08-01T13:00:00.000Z', 'UTC', '13:00', '15:00')).toBe(true); // inclusive start
    expect(isWithinQuietHours('2026-08-01T15:00:00.000Z', 'UTC', '13:00', '15:00')).toBe(false); // exclusive end
  });

  it('handles an overnight window that wraps past midnight (start > end)', () => {
    expect(isWithinQuietHours('2026-08-01T23:30:00.000Z', 'UTC', '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours('2026-08-01T03:00:00.000Z', 'UTC', '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours('2026-08-01T12:00:00.000Z', 'UTC', '22:00', '07:00')).toBe(false);
  });
});

describe('hasDigestIntervalElapsed', () => {
  it('is always eligible when never sent before', () => {
    expect(hasDigestIntervalElapsed(null, 'daily', '2026-08-01T00:00:00.000Z')).toBe(true);
  });

  it('daily: not eligible before 24h, eligible at/after', () => {
    expect(hasDigestIntervalElapsed('2026-08-01T00:00:00.000Z', 'daily', '2026-08-01T23:59:00.000Z')).toBe(false);
    expect(hasDigestIntervalElapsed('2026-08-01T00:00:00.000Z', 'daily', '2026-08-02T00:00:00.000Z')).toBe(true);
  });

  it('weekly: not eligible before 7 days, eligible at/after', () => {
    expect(hasDigestIntervalElapsed('2026-08-01T00:00:00.000Z', 'weekly', '2026-08-07T23:59:00.000Z')).toBe(false);
    expect(hasDigestIntervalElapsed('2026-08-01T00:00:00.000Z', 'weekly', '2026-08-08T00:00:00.000Z')).toBe(true);
  });
});

describe('isDigestGroupEligible', () => {
  it('for a non-instant preference, only the interval matters — quiet hours are irrelevant even if currently active', () => {
    const params = {
      digestFrequency: 'daily' as const,
      lastDigestSentAt: '2026-08-01T00:00:00.000Z',
      quietHoursStart: '00:00',
      quietHoursEnd: '23:59', // "always quiet hours" — would otherwise block everything
      timezone: 'UTC',
      nowIso: '2026-08-02T00:00:00.000Z',
    };
    expect(isDigestGroupEligible(params)).toBe(true); // interval elapsed, quiet hours ignored for daily
    expect(isDigestGroupEligible({ ...params, nowIso: '2026-08-01T12:00:00.000Z' })).toBe(false); // interval not elapsed
  });

  it('for an instant preference, eligibility is exactly "not currently in quiet hours"', () => {
    const params = {
      digestFrequency: 'instant' as const,
      lastDigestSentAt: null,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      timezone: 'UTC',
      nowIso: '2026-08-01T23:00:00.000Z',
    };
    expect(isDigestGroupEligible(params)).toBe(false); // still in quiet hours
    expect(isDigestGroupEligible({ ...params, nowIso: '2026-08-02T08:00:00.000Z' })).toBe(true); // past quiet hours
  });
});

describe('shouldDeferEmailForDigest', () => {
  it('defers when digestFrequency is not instant, regardless of quiet hours', () => {
    expect(
      shouldDeferEmailForDigest({ digestFrequency: 'daily', quietHoursStart: null, quietHoursEnd: null, timezone: 'UTC', nowIso: '2026-08-01T12:00:00.000Z' }),
    ).toBe(true);
  });

  it('defers when instant but currently inside quiet hours', () => {
    expect(
      shouldDeferEmailForDigest({ digestFrequency: 'instant', quietHoursStart: '22:00', quietHoursEnd: '07:00', timezone: 'UTC', nowIso: '2026-08-01T23:00:00.000Z' }),
    ).toBe(true);
  });

  it('does not defer when instant and outside quiet hours', () => {
    expect(
      shouldDeferEmailForDigest({ digestFrequency: 'instant', quietHoursStart: '22:00', quietHoursEnd: '07:00', timezone: 'UTC', nowIso: '2026-08-01T12:00:00.000Z' }),
    ).toBe(false);
  });

  it('does not defer when instant and no quiet hours are configured at all', () => {
    expect(
      shouldDeferEmailForDigest({ digestFrequency: 'instant', quietHoursStart: null, quietHoursEnd: null, timezone: 'UTC', nowIso: '2026-08-01T23:00:00.000Z' }),
    ).toBe(false);
  });
});
