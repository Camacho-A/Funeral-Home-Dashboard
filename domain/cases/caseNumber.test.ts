import { describe, expect, it } from 'vitest';
import { formatCaseNumber, parseCaseNumber } from './caseNumber';

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
