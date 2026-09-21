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

/**
 * Solis go-live checkpoint (DOB/DOD two-digit year expansion). Pivot rule —
 * deliberately the same well-established convention Microsoft Excel's own
 * two-digit-year interpretation has used for decades, rather than an
 * invented one: YY 00-29 -> 20YY, YY 30-99 -> 19YY. For a funeral home's
 * realistic date range (decedents and staff spanning roughly the last
 * ~100 years), this reads correctly in the common cases that matter most —
 * "26" -> 2026 (a same-year date of death), "85" -> 1985, "05" -> 2005 (a
 * young decedent or recent date of birth) — without ever depending on
 * today's date to decide (a fixed, deterministic boundary, documented
 * once, here).
 */
export function expandTwoDigitYear(twoDigitYear: number): number {
  return twoDigitYear <= 29 ? 2000 + twoDigitYear : 1900 + twoDigitYear;
}

/**
 * Solis go-live checkpoint. Expands a fully-typed MM/DD/YY value's
 * two-digit year into MM/DD/YYYY via expandTwoDigitYear above. Anything
 * else (already a 4-digit year, incomplete, malformed) is returned
 * unchanged — this only ever adds digits to a value the user finished
 * typing in full, never reinterprets a value mid-edit. Deliberately not
 * part of formatDateInput's live per-keystroke mask: expanding while the
 * user might still be about to type a 3rd/4th year digit would fight
 * their own typing/correction (see formatDateInput's own "re-derives from
 * raw digits every keystroke" design) — this runs only at commit time
 * (blur/Enter in the UI, and defensively again right before submission).
 */
export function expandTwoDigitYearInDateInput(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(value);
  if (!match) return value;
  const [, month, day, twoDigitYear] = match;
  return `${month}/${day}/${expandTwoDigitYear(Number(twoDigitYear))}`;
}

/**
 * Solis go-live checkpoint. Same convention as isValidCalendarDate ("empty
 * is valid, partial is not") but additionally treats an as-yet-unexpanded
 * two-digit-year value as already valid if expanding it would be —
 * so a field's "is this complete and valid" state (canSubmit/button-enabled
 * logic) reflects a finished MM/DD/YY entry immediately, without waiting
 * for the blur event that actually performs the display-value expansion.
 */
export function isValidCalendarDateAllowingTwoDigitYear(value: string): boolean {
  if (isValidCalendarDate(value)) return true;
  const expanded = expandTwoDigitYearInDateInput(value);
  return expanded !== value && isValidCalendarDate(expanded);
}

function parseMonthDayYearToLocalDate(value: string): Date {
  const [month, day, year] = value.split('/').map(Number);
  // Local-time components only (never `new Date(dateString)`, which some
  // engines parse as UTC midnight) — this is a calendar date, not an
  // instant, and must never shift by a day depending on the server/
  // browser's timezone offset.
  return new Date(year, month - 1, day);
}

/**
 * Solis go-live checkpoint. Cross-field check: Date of Birth cannot be
 * after Date of Death. Returns null (no error) if either field is empty
 * or not yet a complete, valid calendar date on its own — each field's own
 * isValidCalendarDateAllowingTwoDigitYear check already reports that;
 * this only ever adds a *second*, relative-to-each-other error once both
 * individually parse. Accepts either field mid-typing with a two-digit
 * year (expands internally) so it never fights formatDateInput's own
 * per-keystroke mask.
 */
export function getDateOfBirthDeathOrderError(dateOfBirth: string, dateOfDeath: string): string | null {
  const dob = expandTwoDigitYearInDateInput(dateOfBirth);
  const dod = expandTwoDigitYearInDateInput(dateOfDeath);
  if (dob === '' || dod === '' || !isValidCalendarDate(dob) || !isValidCalendarDate(dod)) return null;
  return parseMonthDayYearToLocalDate(dob) > parseMonthDayYearToLocalDate(dod)
    ? 'Date of Birth cannot be after Date of Death.'
    : null;
}

/**
 * Solis go-live checkpoint. Date of Death cannot be an invalid future
 * date — compared against local calendar "today" (midnight-to-midnight),
 * never a UTC day boundary. `now` is injectable for deterministic testing
 * (no real-clock dependency), matching this codebase's established
 * discipline for anything that reads "today."
 */
export function getDateOfDeathFutureError(dateOfDeath: string, now: Date = new Date()): string | null {
  const dod = expandTwoDigitYearInDateInput(dateOfDeath);
  if (dod === '' || !isValidCalendarDate(dod)) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return parseMonthDayYearToLocalDate(dod) > today ? 'Date of Death cannot be in the future.' : null;
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
 * Solis go-live checkpoint (Time of Death military-time input). Replaces
 * the old Phase 19.1 normalizeTimeInput dual 12h/24h parser — this field is
 * never auto-populated with the current time and must never accept an
 * AM/PM form (explicit product requirement), so a live digit-stripping mask
 * is a better fit than blur-time parsing of free text. Reformats raw input
 * toward strict 24-hour "HH:MM" by stripping everything but digits, capping
 * at 4 digits, and inserting ":" after the first two — same approach as
 * formatDateInput above. "0930" -> "09:30" as the user types; backspacing
 * back through the colon and retyping works exactly like formatDateInput's
 * "/" does, since the mask is re-derived from scratch on every keystroke
 * rather than edited in place.
 */
export function formatMilitaryTimeInput(rawValue: string): string {
  const digits = rawValue.replace(/\D/g, '').slice(0, 4);
  const parts = [digits.slice(0, 2), digits.slice(2, 4)].filter(Boolean);
  return parts.join(':');
}

/**
 * True for an empty string (an untouched optional field isn't invalid) or a
 * complete, strict 24-hour "HH:MM" value — hours 00-23, minutes 00-59. No
 * AM/PM form is ever accepted; a partially-typed value ("09:3") is false,
 * matching isValidCalendarDate's "only a fully-typed value can be valid"
 * convention.
 */
export function isValidMilitaryTime(value: string): boolean {
  if (value === '') return true;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
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
      return isValidCalendarDateAllowingTwoDigitYear(value) ? null : 'Enter a valid date (MM/DD/YYYY).';
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
      return isValidMilitaryTime(value) ? null : 'Enter a valid time (HH:MM, 24-hour).';
    default:
      return null;
  }
}
