import { describe, expect, it } from 'vitest';
import {
  formatCaseNumber,
  parseCaseNumber,
  orgLocalYear,
  isValidCaseNumberPrefix,
  caseNumberPrefixFor,
  resolveCaseNumberPrefix,
  parseAnyCaseNumber,
  caseNumberMatchesPrefix,
  DEFAULT_CASE_NUMBER_PREFIX,
} from './caseNumber';

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

/**
 * Manors timezone correction (2026-10). The organization was configured
 * `America/Chicago` while its only location is Oakland Park, Florida —
 * Eastern. This pins the concrete consequence at New Year, which is the
 * sharpest edge the misconfiguration had.
 */
describe('orgLocalYear — Florida must be Eastern, not Central', () => {
  it('a case created at 00:30 Eastern on Jan 1 belongs to the NEW year', () => {
    // 2027-01-01T05:30Z is 00:30 EST on Jan 1 — but 23:30 CST on Dec 31.
    const justAfterMidnightEastern = '2027-01-01T05:30:00.000Z';
    expect(orgLocalYear(justAfterMidnightEastern, 'America/New_York')).toBe(2027);
    // The bug the correction removes: Central would have numbered it 2026.
    expect(orgLocalYear(justAfterMidnightEastern, 'America/Chicago')).toBe(2026);
  });

  it('the two zones agree everywhere outside that one-hour window', () => {
    for (const hour of [6, 12, 18, 23]) {
      const instant = `2027-01-01T${String(hour).padStart(2, '0')}:30:00.000Z`;
      expect(orgLocalYear(instant, 'America/New_York'), instant).toBe(orgLocalYear(instant, 'America/Chicago'));
    }
  });

  it('already-issued case numbers are unaffected — the year is derived only at creation', () => {
    // Nothing re-derives a year for an existing case; this is a pure
    // function of the instant it is called with.
    expect(orgLocalYear('2026-09-30T16:31:23.798Z', 'America/New_York')).toBe(2026);
    expect(orgLocalYear('2026-09-30T16:31:23.798Z', 'America/Chicago')).toBe(2026);
  });
});

/**
 * Per-organization case number prefixes (2026-10). A second funeral home
 * is a different business with its own filing conventions; inheriting
 * another's prefix would be an accident rather than a decision.
 */
describe('organization-specific case number prefixes', () => {
  it('keeps the existing format for an organization that has never set one', () => {
    // Manors' numbers must be byte-identical to before.
    expect(formatCaseNumber(2026, 38)).toBe('B2026-038');
    expect(formatCaseNumber(2026, 38, undefined)).toBe('B2026-038');
    expect(formatCaseNumber(2026, 38, null)).toBe('B2026-038');
    expect(formatCaseNumber(2026, 38, '')).toBe('B2026-038');
  });

  it('uses a configured prefix', () => {
    expect(formatCaseNumber(2026, 1, 'G')).toBe('G2026-001');
    expect(formatCaseNumber(2026, 1, 'GCJ')).toBe('GCJ2026-001');
  });

  it('normalises a prefix that was typed in lower case or padded', () => {
    expect(formatCaseNumber(2026, 1, ' g ')).toBe('G2026-001');
  });

  it('falls back rather than producing a malformed number', () => {
    // A prefix that could not be parsed back must never be written into a
    // case number — better the default than an unparseable identifier.
    for (const bad of ['B2', '!!', 'TOOLONG', '1', ' ']) {
      expect(formatCaseNumber(2026, 1, bad)).toBe('B2026-001');
    }
  });

  it('round-trips a number through its own prefix', () => {
    expect(parseCaseNumber('G2026-007', 'G')).toEqual({ year: 2026, sequence: 7 });
    expect(parseCaseNumber('B2026-038')).toEqual({ year: 2026, sequence: 38 });
  });

  it('does not read one organization\'s number as another\'s', () => {
    // A Gus Camacho number parsed with the Manors prefix is not a match.
    expect(parseCaseNumber('G2026-007')).toBeNull();
    expect(parseCaseNumber('B2026-038', 'G')).toBeNull();
  });

  it('validates what may be stored as a prefix', () => {
    expect(isValidCaseNumberPrefix('B')).toBe(true);
    expect(isValidCaseNumberPrefix('GCJ')).toBe(true);
    expect(isValidCaseNumberPrefix('g')).toBe(false);
    expect(isValidCaseNumberPrefix('')).toBe(false);
    expect(isValidCaseNumberPrefix('ABCD')).toBe(false);
    expect(isValidCaseNumberPrefix('B1')).toBe(false);
  });

  it('resolves a stored value to the prefix actually used', () => {
    expect(caseNumberPrefixFor(undefined)).toBe('B');
    expect(caseNumberPrefixFor('GCJ')).toBe('GCJ');
    expect(caseNumberPrefixFor('bad!')).toBe('B');
  });
});


/**
 * resolveCaseNumberPrefix (2026-10) — the single source of truth for an
 * organization's prefix: record -> profile default -> known org default ->
 * legacy "B".
 */
describe('resolveCaseNumberPrefix', () => {
  it("prefers the organization record's own valid caseNumberPrefix", () => {
    expect(resolveCaseNumberPrefix({ id: 'managed-cremations', caseNumberPrefix: 'M' })).toBe('M');
    expect(resolveCaseNumberPrefix({ id: 'x', caseNumberPrefix: ' gcj ' })).toBe('GCJ');
  });

  it('falls back to the organization-profile default when the record has none (or an invalid one)', () => {
    expect(resolveCaseNumberPrefix({ id: 'x' }, { profileDefault: 'Q' })).toBe('Q');
    expect(resolveCaseNumberPrefix({ id: 'x', caseNumberPrefix: 'B1' }, { profileDefault: 'Q' })).toBe('Q');
  });

  it('knows Gus Camacho is M and Manors is B even without a stored prefix', () => {
    expect(resolveCaseNumberPrefix(null, { organizationId: 'gus-camacho-jr' })).toBe('M');
    expect(resolveCaseNumberPrefix({ id: 'gus-camacho-jr' })).toBe('M');
    expect(resolveCaseNumberPrefix(null, { organizationId: 'managed-cremations' })).toBe('B');
  });

  it('uses the legacy "B" default only for an unknown organization with nothing configured', () => {
    expect(resolveCaseNumberPrefix(null)).toBe(DEFAULT_CASE_NUMBER_PREFIX);
    expect(resolveCaseNumberPrefix(undefined, { organizationId: 'evergreen-memorial-group' })).toBe('B');
    expect(resolveCaseNumberPrefix({ id: 'constructor' })).toBe('B');
  });
});

describe('generic, prefix-aware format/parse', () => {
  it('formats and parses M numbers (Gus Camacho)', () => {
    expect(formatCaseNumber(2026, 1, 'M')).toBe('M2026-001');
    expect(parseCaseNumber('M2026-001', 'M')).toEqual({ year: 2026, sequence: 1 });
  });

  it('parseAnyCaseNumber reads any valid prefix', () => {
    expect(parseAnyCaseNumber('M2026-004')).toEqual({ prefix: 'M', year: 2026, sequence: 4 });
    expect(parseAnyCaseNumber('GCJ2027-1200')).toEqual({ prefix: 'GCJ', year: 2027, sequence: 1200 });
    expect(parseAnyCaseNumber('2026-004')).toBeNull();
    expect(parseAnyCaseNumber('ABCD2026-004')).toBeNull();
    expect(parseAnyCaseNumber('m2026-004')).toBeNull();
  });

  it('caseNumberMatchesPrefix rejects mismatched or invalid prefixes', () => {
    expect(caseNumberMatchesPrefix('M2026-001', 'M')).toBe(true);
    expect(caseNumberMatchesPrefix('B2026-001', 'M')).toBe(false);
    expect(caseNumberMatchesPrefix('M2026-001', 'B')).toBe(false);
    // An invalid prefix must never fall back to the default and "match" B.
    expect(caseNumberMatchesPrefix('B2026-001', 'b1')).toBe(false);
    expect(caseNumberMatchesPrefix('B2026-001', '')).toBe(false);
  });
});
