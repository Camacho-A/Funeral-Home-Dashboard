/**
 * Generic, domain-independent input-formatting/validation helpers — not a
 * funeral-home business rule (any form with a date or a card expiry field
 * would want these), which is why they live here rather than in domain/.
 * Used by components/modals/NewCaseModal.tsx (Phase 16A).
 */

/**
 * Reformats raw input toward MM/DD/YYYY by stripping everything but digits
 * and re-inserting "/" at the MM|DD and DD|YYYY boundaries — so typing
 * "07202026" (or typing through/pasting over existing slashes) always
 * renders as "07/20/2026" without the user typing the slashes themselves.
 */
export function formatDateInput(rawValue: string): string {
  const digits = rawValue.replace(/\D/g, '').slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  return parts.join('/');
}

/**
 * True for an empty string (an untouched optional date field isn't
 * "invalid") or a complete MM/DD/YYYY value that names a real calendar
 * date. False for a partially-typed value, an out-of-range month/day, or a
 * structurally-plausible but nonexistent date (02/30/2026) — relies on
 * JS Date's own month/day rollover (e.g. Date(2026, 1, 30) rolls over to
 * March) to catch the latter, rather than hand-rolling a days-per-month
 * table.
 */
export function isValidCalendarDate(value: string): boolean {
  if (value === '') return true;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return false;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** Reformats raw input toward MM/YY, inserting "/" after the month —
    same digit-stripping approach as formatDateInput, capped at 4 digits. */
export function formatCardExpiryInput(rawValue: string): string {
  const digits = rawValue.replace(/\D/g, '').slice(0, 4);
  const parts = [digits.slice(0, 2), digits.slice(2, 4)].filter(Boolean);
  return parts.join('/');
}

/** True for an empty string or a complete MM/YY value whose month is
    01-12. Does not judge whether the expiry itself is in the past — this
    phase's own scope is "validate the month range," not full expiry
    business-logic validation. */
export function isValidExpiryMonth(value: string): boolean {
  if (value === '') return true;
  const match = /^(\d{2})\/(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[1]);
  return month >= 1 && month <= 12;
}

/**
 * Phase 19 (Configurable Intake Form Builder). Validators for the
 * additional IntakeValidationType options a configurable intake field can
 * select — generic, domain-independent (any form with an email/phone/zip/
 * currency/card-number field would want these), same as everything else
 * in this file. Each follows the same "empty string is valid — an
 * untouched optional field isn't invalid" convention as isValidCalendarDate/
 * isValidExpiryMonth above; a required-but-blank field is a separate
 * concern (IntakeFieldTemplate.required), not this function's job.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  if (value === '') return true;
  return EMAIL_PATTERN.test(value);
}

/** Loose on purpose — accepts any punctuation/spacing a caller typed
    (parens, dashes, a leading +1, ...) and just checks there are enough
    digits to plausibly be a phone number (7-15, per the international
    E.164 length range). No formatting mask is applied — nextOfKinPhone
    has never been auto-formatted (see components/modals/NewCaseModal.tsx's
    Phase 16A comment on what's deliberately excluded from masking), and
    this phase doesn't change that. */
export function isValidPhoneNumber(value: string): boolean {
  if (value === '') return true;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;

export function isValidZip(value: string): boolean {
  if (value === '') return true;
  return ZIP_PATTERN.test(value);
}

const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;

export function isValidNumeric(value: string): boolean {
  if (value === '') return true;
  return NUMERIC_PATTERN.test(value);
}

/** Accepts a plain number, optionally with a leading "$" and/or thousands
    commas (e.g. "1234.56", "$1,234.56") — validation only, no live
    formatting mask (this phase's scope is "validationType: currency," not
    a currency-input-masking library). */
const CURRENCY_PATTERN = /^\$?\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\$?\d+(\.\d{1,2})?$/;

export function isValidCurrencyAmount(value: string): boolean {
  if (value === '') return true;
  return CURRENCY_PATTERN.test(value);
}

/** Strips spaces/dashes, requires 13-19 digits (the real-world PAN length
    range), then applies the Luhn checksum — a genuine structural check,
    not just "looks like digits." */
export function isValidCreditCardNumber(value: string): boolean {
  if (value === '') return true;
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;

  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/**
 * Single dispatcher from an IntakeFieldTemplate's `validationType` to the
 * right validator above (or the date/expiry ones already established) plus
 * a user-facing message — replaces components/modals/NewCaseModal.tsx's
 * old fieldValidationError, which hardcoded per-*key* checks (DATE_FIELD_KEYS,
 * EXPIRY_FIELD_KEYS) instead of reading a field's own configured
 * validationType. Returns null for a valid (or empty/untouched) value.
 */
/**
 * Phase 19.1 (Time Input Normalization). Parses familiar 12-hour input
 * ("2:30 PM", "2:30PM", "2 PM", "02:30 am") as well as direct 24-hour input
 * ("14:30") into a canonical, zero-padded 24-hour "HH:mm" string — the only
 * form ever persisted (see components/modals/NewCaseModal.tsx and
 * components/case/CaseInformationCard.tsx, the two callers, neither of
 * which re-implements this parsing). Returns `null` for anything invalid
 * or ambiguous; returns `''` for an empty string (an untouched optional
 * field isn't invalid, same convention as isValidCalendarDate above).
 *
 * Ambiguity rule: a bare "HH:mm" with no AM/PM marker is only accepted
 * when it's *unambiguously* 24-hour notation — hour 0, or 13-23. Hours
 * 1-12 without an AM/PM marker are rejected outright ("2:30" alone is
 * genuinely ambiguous between 2 AM and 2 PM); with an AM/PM marker, only
 * hours 1-12 are valid (12-hour clocks have no "13 PM" or "0 PM").
 */
export function normalizeTimeInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return '';

  const twelveHourMatch = /^(\d{1,2})(?::(\d{2}))?\s*([aApP][mM])$/.exec(trimmed);
  if (twelveHourMatch) {
    const hour = Number(twelveHourMatch[1]);
    const minute = twelveHourMatch[2] !== undefined ? Number(twelveHourMatch[2]) : 0;
    const meridiem = twelveHourMatch[3].toLowerCase();
    if (hour < 1 || hour > 12) return null;
    if (minute < 0 || minute > 59) return null;
    const hour24 = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
    return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const twentyFourHourMatch = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (twentyFourHourMatch) {
    const hour = Number(twentyFourHourMatch[1]);
    const minute = Number(twentyFourHourMatch[2]);
    if (hour < 0 || hour > 23) return null;
    if (minute < 0 || minute > 59) return null;
    if (hour >= 1 && hour <= 12) return null; // ambiguous without AM/PM
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  return null;
}

export function getValidationError(
  validationType:
    | 'none'
    | 'email'
    | 'phone'
    | 'date'
    | 'zip'
    | 'numeric'
    | 'currency'
    | 'creditCard'
    | 'expiration'
    | 'time',
  value: string,
): string | null {
  switch (validationType) {
    case 'none':
      return null;
    case 'email':
      return isValidEmail(value) ? null : 'Enter a valid email address.';
    case 'phone':
      return isValidPhoneNumber(value) ? null : 'Enter a valid phone number.';
    case 'date':
      return isValidCalendarDate(value) ? null : 'Enter a valid date (MM/DD/YYYY).';
    case 'zip':
      return isValidZip(value) ? null : 'Enter a valid ZIP code.';
    case 'numeric':
      return isValidNumeric(value) ? null : 'Enter a number.';
    case 'currency':
      return isValidCurrencyAmount(value) ? null : 'Enter a valid amount.';
    case 'creditCard':
      return isValidCreditCardNumber(value) ? null : 'Enter a valid card number.';
    case 'expiration':
      return isValidExpiryMonth(value) ? null : 'Enter a valid expiration (MM/YY).';
    case 'time':
      return normalizeTimeInput(value) !== null ? null : 'Enter a valid time (e.g. 2:30 PM or 14:30).';
    default:
      return null;
  }
}
