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
