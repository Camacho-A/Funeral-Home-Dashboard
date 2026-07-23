import { describe, expect, it } from 'vitest';
import { formatDateInput, isValidCalendarDate, formatCardExpiryInput, isValidExpiryMonth } from './inputMask';

describe('formatDateInput', () => {
  it('inserts "/" at the MM|DD and DD|YYYY boundaries', () => {
    expect(formatDateInput('07202026')).toBe('07/20/2026');
  });

  it('formats progressively as digits accumulate', () => {
    expect(formatDateInput('0')).toBe('0');
    expect(formatDateInput('07')).toBe('07');
    expect(formatDateInput('072')).toBe('07/2');
    expect(formatDateInput('0720')).toBe('07/20');
    expect(formatDateInput('07202')).toBe('07/20/2');
  });

  it('strips non-digit characters (typing through existing slashes)', () => {
    expect(formatDateInput('07/20/2026')).toBe('07/20/2026');
  });

  it('caps at 8 digits', () => {
    expect(formatDateInput('072020269999')).toBe('07/20/2026');
  });

  it('returns an empty string for empty input', () => {
    expect(formatDateInput('')).toBe('');
  });
});

describe('isValidCalendarDate', () => {
  it('treats an empty string as valid (optional field, nothing to judge yet)', () => {
    expect(isValidCalendarDate('')).toBe(true);
  });

  it('treats a partially-typed value as invalid', () => {
    expect(isValidCalendarDate('07/20')).toBe(false);
    expect(isValidCalendarDate('07')).toBe(false);
  });

  it('accepts a real, complete calendar date', () => {
    expect(isValidCalendarDate('07/20/2026')).toBe(true);
    expect(isValidCalendarDate('01/01/2000')).toBe(true);
  });

  it('rejects an out-of-range month', () => {
    expect(isValidCalendarDate('13/01/2026')).toBe(false);
    expect(isValidCalendarDate('00/01/2026')).toBe(false);
  });

  it('rejects a day that does not exist in the given month', () => {
    expect(isValidCalendarDate('02/30/2026')).toBe(false); // Feb never has 30 days
    expect(isValidCalendarDate('04/31/2026')).toBe(false); // April has 30 days
  });

  it('correctly accepts Feb 29 on a leap year and rejects it on a non-leap year', () => {
    expect(isValidCalendarDate('02/29/2024')).toBe(true); // 2024 is a leap year
    expect(isValidCalendarDate('02/29/2026')).toBe(false); // 2026 is not
  });

  it('rejects a malformed string entirely', () => {
    expect(isValidCalendarDate('not a date')).toBe(false);
    expect(isValidCalendarDate('2026/07/20')).toBe(false);
  });
});

describe('formatCardExpiryInput', () => {
  it('inserts "/" after the month', () => {
    expect(formatCardExpiryInput('1228')).toBe('12/28');
  });

  it('formats progressively', () => {
    expect(formatCardExpiryInput('1')).toBe('1');
    expect(formatCardExpiryInput('12')).toBe('12');
    expect(formatCardExpiryInput('122')).toBe('12/2');
  });

  it('strips non-digit characters and caps at 4 digits', () => {
    expect(formatCardExpiryInput('12/28')).toBe('12/28');
    expect(formatCardExpiryInput('1228999')).toBe('12/28');
  });
});

describe('isValidExpiryMonth', () => {
  it('treats an empty string as valid', () => {
    expect(isValidExpiryMonth('')).toBe(true);
  });

  it('treats a partially-typed value as invalid', () => {
    expect(isValidExpiryMonth('12')).toBe(false);
  });

  it('accepts a month in range 01-12', () => {
    expect(isValidExpiryMonth('01/28')).toBe(true);
    expect(isValidExpiryMonth('12/28')).toBe(true);
  });

  it('rejects an out-of-range month', () => {
    expect(isValidExpiryMonth('00/28')).toBe(false);
    expect(isValidExpiryMonth('13/28')).toBe(false);
  });
});
