import { describe, it, expect } from 'vitest';
import { formatPhoneNumber, formatPhoneNumberOr } from './phoneNumber';

describe('formatPhoneNumber', () => {
  it('formats US numbers however they were entered', () => {
    // The shapes a number actually arrives in: typed, pasted, imported.
    expect(formatPhoneNumber('9545551234')).toBe('(954) 555-1234');
    expect(formatPhoneNumber('954-555-1234')).toBe('(954) 555-1234');
    expect(formatPhoneNumber('954.555.1234')).toBe('(954) 555-1234');
    expect(formatPhoneNumber('(954)5551234')).toBe('(954) 555-1234');
    expect(formatPhoneNumber('+1 954 555 1234')).toBe('(954) 555-1234');
    expect(formatPhoneNumber('954 555 1234')).toBe('(954) 555-1234');
    expect(formatPhoneNumber('1-954-555-1234')).toBe('(954) 555-1234');
    expect(formatPhoneNumber('(954) 555-1234')).toBe('(954) 555-1234');
  });

  it('preserves every digit it was given', () => {
    // The one thing a display formatter must never do is change the number.
    const formatted = formatPhoneNumber('954.555.1234');
    expect(formatted.replace(/\D/g, '')).toBe('9545551234');
  });

  it('keeps extensions and labels them clearly', () => {
    expect(formatPhoneNumber('9545551234 ext. 205')).toBe('(954) 555-1234 ext. 205');
    expect(formatPhoneNumber('954-555-1234 ext 205')).toBe('(954) 555-1234 ext. 205');
    expect(formatPhoneNumber('954-555-1234 x205')).toBe('(954) 555-1234 ext. 205');
    expect(formatPhoneNumber('954-555-1234 X 205')).toBe('(954) 555-1234 ext. 205');
    expect(formatPhoneNumber('(954) 555-1234 #205')).toBe('(954) 555-1234 ext. 205');
    expect(formatPhoneNumber('9545551234, ext 1')).toBe('(954) 555-1234 ext. 1');
    expect(formatPhoneNumber('9545551234 extension 4120')).toBe('(954) 555-1234 ext. 4120');
  });

  it('never mistakes an extension for part of the number', () => {
    expect(formatPhoneNumber('9545551234 x205').replace(/\D/g, '')).toBe('9545551234205');
    // The area code is still the area code, not shifted by the extension.
    expect(formatPhoneNumber('9545551234 x205').startsWith('(954)')).toBe(true);
  });

  it('leaves international numbers in their own format', () => {
    // +44 is not a US number and must never be bracketed as one.
    expect(formatPhoneNumber('+44 20 7946 0958')).toBe('+44 20 7946 0958');
    expect(formatPhoneNumber('+52 55 1234 5678')).toBe('+52 55 1234 5678');
    expect(formatPhoneNumber('+1 809 555 1234')).toBe('(809) 555-1234');
  });

  it('shows an incomplete historical number as stored, never "repaired"', () => {
    // A funeral home's old records must not be rejected or invented into.
    expect(formatPhoneNumber('555-1234')).toBe('555-1234');
    expect(formatPhoneNumber('954555')).toBe('954555');
    expect(formatPhoneNumber('12345678901234')).toBe('12345678901234');
  });

  it('passes through text that is not a number at all', () => {
    expect(formatPhoneNumber('unknown')).toBe('unknown');
    expect(formatPhoneNumber('see file')).toBe('see file');
    expect(formatPhoneNumber('N/A')).toBe('N/A');
  });

  it('treats absent values as empty rather than throwing', () => {
    expect(formatPhoneNumber(null)).toBe('');
    expect(formatPhoneNumber(undefined)).toBe('');
    expect(formatPhoneNumber('')).toBe('');
    expect(formatPhoneNumber('   ')).toBe('');
  });

  it('trims surrounding whitespace from a pasted value', () => {
    expect(formatPhoneNumber('  9545551234  ')).toBe('(954) 555-1234');
    expect(formatPhoneNumber('\n954-555-1234\t')).toBe('(954) 555-1234');
  });

  it('is idempotent — formatting an already-formatted number changes nothing', () => {
    // Display formatters run on every render; the second pass must be a
    // no-op, including for extensions and international numbers.
    for (const value of ['(954) 555-1234', '(954) 555-1234 ext. 205', '+44 20 7946 0958', '555-1234', '']) {
      expect(formatPhoneNumber(formatPhoneNumber(value))).toBe(formatPhoneNumber(value));
    }
  });

  it('does not treat a bare extension-looking value as an extension', () => {
    expect(formatPhoneNumber('x205')).toBe('x205');
  });
});

describe('formatPhoneNumberOr', () => {
  it('formats a present number', () => {
    expect(formatPhoneNumberOr('9545551234', '—')).toBe('(954) 555-1234');
  });

  it('uses the placeholder so a missing number reads as missing', () => {
    expect(formatPhoneNumberOr(null, '—')).toBe('—');
    expect(formatPhoneNumberOr('', 'Not provided')).toBe('Not provided');
    expect(formatPhoneNumberOr('   ', '—')).toBe('—');
  });
});

/**
 * The guarantees the rest of SOLIS relies on when it formats a number for
 * display instead of rewriting what is stored.
 */
describe('formatPhoneNumber as a display-only formatter', () => {
  it('never changes the digits of any value it reformats', () => {
    const cases = [
      '9545551234',
      '954-555-1234',
      '954.555.1234',
      '(954)5551234',
      '+1 954 555 1234',
      '1-954-555-1234',
      '9545551234 ext. 205',
      '+44 20 7946 0958',
      '555-1234',
    ];
    for (const value of cases) {
      expect(formatPhoneNumber(value).replace(/\D/g, '')).toBe(
        // `+1`'s country code is presentation, not a digit of the number.
        value.replace(/^\+?1(?=\D*\d{3}\D*\d{3}\D*\d{4}\s*$)/, '').replace(/\D/g, ''),
      );
    }
  });

  it('is safe to apply to a value a staff member is midway through typing', () => {
    // Incomplete input is returned as-is, so a field that formats only
    // what it displays can never eat a half-typed number.
    for (const partial of ['9', '95', '954', '954555', '954-555-12']) {
      expect(formatPhoneNumber(partial)).toBe(partial);
    }
  });
});
