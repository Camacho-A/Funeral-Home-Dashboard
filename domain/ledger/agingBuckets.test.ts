import { describe, expect, it } from 'vitest';
import { ageDaysBetween, bucketForAgeDays, bucketForAging } from './agingBuckets';

describe('ageDaysBetween', () => {
  it('computes whole days between two ISO dates', () => {
    expect(ageDaysBetween('2026-01-01T00:00:00.000Z', '2026-01-15T00:00:00.000Z')).toBe(14);
  });

  it('never returns a negative age, even if asOfDate is before anchorDate', () => {
    expect(ageDaysBetween('2026-01-15T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(0);
  });

  it('returns 0 for the same instant', () => {
    expect(ageDaysBetween('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(0);
  });
});

describe('bucketForAgeDays', () => {
  it('buckets 0 days as 0-30', () => {
    expect(bucketForAgeDays(0)).toBe('0-30');
  });

  it('buckets 30 days as 0-30 (inclusive boundary)', () => {
    expect(bucketForAgeDays(30)).toBe('0-30');
  });

  it('buckets 31 days as 31-60', () => {
    expect(bucketForAgeDays(31)).toBe('31-60');
  });

  it('buckets 60 days as 31-60 (inclusive boundary)', () => {
    expect(bucketForAgeDays(60)).toBe('31-60');
  });

  it('buckets 61 days as 61-90', () => {
    expect(bucketForAgeDays(61)).toBe('61-90');
  });

  it('buckets 90 days as 61-90 (inclusive boundary)', () => {
    expect(bucketForAgeDays(90)).toBe('61-90');
  });

  it('buckets 91 days as 90+', () => {
    expect(bucketForAgeDays(91)).toBe('90+');
  });

  it('buckets a very large age as 90+', () => {
    expect(bucketForAgeDays(9000)).toBe('90+');
  });
});

describe('bucketForAging', () => {
  it('composes ageDaysBetween and bucketForAgeDays', () => {
    expect(bucketForAging('2026-01-01T00:00:00.000Z', '2026-04-15T00:00:00.000Z')).toBe('90+');
  });

  it('a case order edit that only changes the CURRENT version does not affect aging, since the anchor is always the first version — this is enforced by the caller (getArAgingReport), not this function; this test documents that the function itself is a pure date-math primitive with no opinion on which date is passed', () => {
    const v1AnchorDate = '2026-01-01T00:00:00.000Z';
    const asOfDate = '2026-01-20T00:00:00.000Z';
    expect(bucketForAging(v1AnchorDate, asOfDate)).toBe('0-30');
  });
});
