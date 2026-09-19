import { describe, expect, it } from 'vitest';
import { formatCaseNumber, parseCaseNumber, orgLocalYear } from './caseNumber';

describe('formatCaseNumber', () => {
  it('formats with a 3-digit, zero-padded sequence', () => {
    expect(formatCaseNumber(2026, 1)).toBe('B2026-001');
    expect(formatCaseNumber(2026, 57)).toBe('B2026-057');
    expect(formatCaseNumber(2026, 58)).toBe('B2026-058');
  });

  it('does not truncate a sequence with more than 3 digits', () => {
    expect(formatCaseNumber(2026, 1000)).toBe('B2026-1000');
  });

  it('always uses the fixed "B" prefix', () => {
    expect(formatCaseNumber(2027, 1)).toBe('B2027-001');
  });
});

describe('parseCaseNumber', () => {
  it('parses a well-formed case number', () => {
    expect(parseCaseNumber('B2026-001')).toEqual({ year: 2026, sequence: 1 });
    expect(parseCaseNumber('B2026-058')).toEqual({ year: 2026, sequence: 58 });
  });

  it('round-trips with formatCaseNumber', () => {
    const formatted = formatCaseNumber(2026, 42);
    expect(parseCaseNumber(formatted)).toEqual({ year: 2026, sequence: 42 });
  });

  it('returns null for a malformed or differently-shaped string', () => {
    expect(parseCaseNumber('2026-001')).toBeNull();
    expect(parseCaseNumber('A2026-001')).toBeNull();
    expect(parseCaseNumber('B26-001')).toBeNull();
    expect(parseCaseNumber('B2026-1')).toBeNull();
    expect(parseCaseNumber('not a case number')).toBeNull();
    expect(parseCaseNumber('')).toBeNull();
  });
});

describe('orgLocalYear (Manors launch-prep — P0 automatic case numbering)', () => {
  it('defaults to UTC when the organization has no configured timezone', () => {
    expect(orgLocalYear('2027-01-01T00:30:00.000Z', undefined)).toBe(2027);
    expect(orgLocalYear('2026-12-31T23:30:00.000Z', undefined)).toBe(2026);
  });

  it('does NOT roll over to the new year just because UTC already has, for a timezone behind UTC', () => {
    // 2027-01-01T04:30:00Z is already Jan 1 in UTC, but only 2026-12-31
    // 23:30 in America/New_York (UTC-5 in winter) — a case created at this
    // exact instant must still get a B2026-... number, not B2027-....
    expect(orgLocalYear('2027-01-01T04:30:00.000Z', 'America/New_York')).toBe(2026);
  });

  it('rolls over to the new year before UTC does, for a timezone ahead of UTC', () => {
    // 2026-12-31T20:00:00Z is still Dec 31 in UTC, but already 2027-01-01
    // 05:00 in Asia/Tokyo (UTC+9) — a case created at this exact instant
    // must get a B2027-... number even though the server/UTC clock hasn't
    // rolled over yet.
    expect(orgLocalYear('2026-12-31T20:00:00.000Z', 'Asia/Tokyo')).toBe(2027);
  });

  it('assigns the new year to a case created shortly after local midnight on January 1st', () => {
    // 2027-01-01T00:05:00 in America/New_York = 2027-01-01T05:05:00Z.
    expect(orgLocalYear('2027-01-01T05:05:00.000Z', 'America/New_York')).toBe(2027);
  });
});
