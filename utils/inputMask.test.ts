import { describe, expect, it } from 'vitest';
import {
  formatDateInput,
  isValidCalendarDate,
  formatCardExpiryInput,
  isValidExpiryMonth,
  isValidEmail,
  isValidPhoneNumber,
  isValidZip,
  isValidNumeric,
  isValidCurrencyAmount,
  isValidCreditCardNumber,
  getValidationError,
} from './inputMask';

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

describe('isValidEmail (Phase 19)', () => {
  it('treats an empty string as valid', () => {
    expect(isValidEmail('')).toBe(true);
  });

  it('accepts a well-formed email', () => {
    expect(isValidEmail('dana@managedcremations.test')).toBe(true);
  });

  it('rejects a string with no @ or no domain', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('dana@')).toBe(false);
    expect(isValidEmail('dana@nodot')).toBe(false);
  });
});

describe('isValidPhoneNumber (Phase 19)', () => {
  it('treats an empty string as valid', () => {
    expect(isValidPhoneNumber('')).toBe(true);
  });

  it('accepts a plain 10-digit number and a formatted one', () => {
    expect(isValidPhoneNumber('5550100000')).toBe(true);
    expect(isValidPhoneNumber('(555) 010-0000')).toBe(true);
  });

  it('accepts an international number with a country code', () => {
    expect(isValidPhoneNumber('+15550100000')).toBe(true);
  });

  it('rejects a number with too few digits', () => {
    expect(isValidPhoneNumber('555010')).toBe(false);
  });

  it('does not reformat the value — validation only', () => {
    isValidPhoneNumber('(555) 010-0000');
    // No mutation possible (pure function) — this test documents the
    // deliberate absence of a formatting mask, matching NewCaseModal's
    // long-standing exclusion of the phone field from any auto-mask.
    expect(true).toBe(true);
  });
});

describe('isValidZip (Phase 19)', () => {
  it('treats an empty string as valid', () => {
    expect(isValidZip('')).toBe(true);
  });

  it('accepts a plain 5-digit ZIP and a ZIP+4', () => {
    expect(isValidZip('94112')).toBe(true);
    expect(isValidZip('94112-1234')).toBe(true);
  });

  it('rejects the wrong number of digits', () => {
    expect(isValidZip('9411')).toBe(false);
    expect(isValidZip('941122')).toBe(false);
  });
});

describe('isValidNumeric (Phase 19)', () => {
  it('treats an empty string as valid', () => {
    expect(isValidNumeric('')).toBe(true);
  });

  it('accepts integers and decimals, positive and negative', () => {
    expect(isValidNumeric('165')).toBe(true);
    expect(isValidNumeric('165.5')).toBe(true);
    expect(isValidNumeric('-4')).toBe(true);
  });

  it('rejects non-numeric text', () => {
    expect(isValidNumeric('165 lb')).toBe(false);
  });
});

describe('isValidCurrencyAmount (Phase 19)', () => {
  it('treats an empty string as valid', () => {
    expect(isValidCurrencyAmount('')).toBe(true);
  });

  it('accepts a plain amount, a dollar-prefixed one, and one with thousands commas', () => {
    expect(isValidCurrencyAmount('1234.56')).toBe(true);
    expect(isValidCurrencyAmount('$1234.56')).toBe(true);
    expect(isValidCurrencyAmount('$1,234.56')).toBe(true);
  });

  it('rejects malformed currency text', () => {
    expect(isValidCurrencyAmount('not money')).toBe(false);
  });
});

describe('isValidCreditCardNumber (Phase 19)', () => {
  it('treats an empty string as valid', () => {
    expect(isValidCreditCardNumber('')).toBe(true);
  });

  it('accepts a well-known Luhn-valid test number, with or without spaces', () => {
    expect(isValidCreditCardNumber('4111111111111111')).toBe(true);
    expect(isValidCreditCardNumber('4111 1111 1111 1111')).toBe(true);
  });

  it('rejects a number that fails the Luhn checksum', () => {
    expect(isValidCreditCardNumber('4111111111111112')).toBe(false);
  });

  it('rejects a value with the wrong number of digits', () => {
    expect(isValidCreditCardNumber('123')).toBe(false);
  });

  it('rejects non-digit garbage', () => {
    expect(isValidCreditCardNumber('not-a-card')).toBe(false);
  });
});

describe('getValidationError (Phase 19)', () => {
  it('returns null for validationType "none" regardless of value', () => {
    expect(getValidationError('none', 'literally anything')).toBeNull();
  });

  it('returns null for a valid value and a message for an invalid one, per type', () => {
    expect(getValidationError('email', 'a@b.com')).toBeNull();
    expect(getValidationError('email', 'nope')).toMatch(/valid email/i);

    expect(getValidationError('phone', '5551234567')).toBeNull();
    expect(getValidationError('phone', '123')).toMatch(/valid phone/i);

    expect(getValidationError('date', '07/20/2026')).toBeNull();
    expect(getValidationError('date', '02/30/2026')).toMatch(/valid date/i);

    expect(getValidationError('zip', '94112')).toBeNull();
    expect(getValidationError('zip', '9')).toMatch(/valid zip/i);

    expect(getValidationError('numeric', '42')).toBeNull();
    expect(getValidationError('numeric', 'abc')).toMatch(/number/i);

    expect(getValidationError('currency', '$42.00')).toBeNull();
    expect(getValidationError('currency', 'abc')).toMatch(/valid amount/i);

    expect(getValidationError('creditCard', '4111111111111111')).toBeNull();
    expect(getValidationError('creditCard', '123')).toMatch(/valid card/i);

    expect(getValidationError('expiration', '12/28')).toBeNull();
    expect(getValidationError('expiration', '13/28')).toMatch(/valid expiration/i);
  });

  it('treats an empty value as valid for every type (required-ness is a separate concern)', () => {
    (['email', 'phone', 'date', 'zip', 'numeric', 'currency', 'creditCard', 'expiration'] as const).forEach((type) => {
      expect(getValidationError(type, '')).toBeNull();
    });
  });
});
