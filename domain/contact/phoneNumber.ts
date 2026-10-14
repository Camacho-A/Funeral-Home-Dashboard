/**
 * Phone and fax number display formatting (2026-10).
 *
 * One rule for every phone and fax number SOLIS shows: a US number reads
 * `(954) 555-1234`, whatever shape it was typed, pasted, or imported in.
 *
 * **This is a DISPLAY formatter, not a data migration.** Stored values are
 * left exactly as entered — every digit preserved — and formatting happens
 * at render time. That means historical cases, JotForm imports, and
 * hand-typed numbers all present identically with no production data
 * rewrite, and nothing can corrupt a stored number by reformatting it
 * wrongly.
 *
 * The formatter is deliberately CONSERVATIVE. It reformats only what it
 * can positively identify as a US number; anything else is returned
 * untouched rather than forced into a shape it does not fit:
 *
 * - Fewer digits than a US number (a historical record with a partial
 *   number) is shown as stored. A funeral home's old records are not
 *   rejected or "repaired" — see §5's "do not reject historical case
 *   records solely because they contain an incomplete number."
 * - An international number keeps its own format. `+44 20 7946 0958` is
 *   not a US number and must never be bracketed as one.
 * - An extension is preserved and labelled: `(954) 555-1234 ext. 205`.
 *
 * Never invents, drops, or alters a digit.
 */

/** `ext`, `ext.`, `x`, `ext:`, `extension`, or `#` — the ways an extension
    actually arrives from a form, a staff member, or an imported record. */
const EXTENSION_PATTERN = /[\s,;]*(?:e?xt?n?\.?:?|extension\.?:?|#)\s*(\d{1,6})\s*$/i;

/** What's left of a number once the extension is taken off. */
type SplitNumber = { base: string; extension: string | null };

function splitExtension(value: string): SplitNumber {
  const match = EXTENSION_PATTERN.exec(value);
  if (!match) return { base: value.trim(), extension: null };

  const base = value.slice(0, match.index).trim();
  // A bare "x205" with nothing before it is the whole value, not an
  // extension hanging off a number — leave it alone.
  if (base === '') return { base: value.trim(), extension: null };
  return { base, extension: match[1] };
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * True when `base` is a US number this may reformat.
 *
 * Ten digits, or eleven beginning with the US country code. An explicit
 * `+` prefix only qualifies as `+1` — any other country code belongs to a
 * numbering plan with its own conventions.
 */
function usNationalDigits(base: string): string | null {
  const digits = digitsOf(base);
  const hasPlus = base.trim().startsWith('+');

  if (hasPlus) {
    return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : null;
  }
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return null;
}

/**
 * A phone or fax number as SOLIS displays it.
 *
 * Returns the input unchanged (trimmed) whenever it is not a US number —
 * including empty, partial, and international values — so no caller has to
 * guard before using it.
 */
export function formatPhoneNumber(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (raw === '') return '';

  const { base, extension } = splitExtension(raw);
  const national = usNationalDigits(base);
  if (national === null) {
    // Not a US number: preserve it exactly, extension and all. Re-joining
    // from the parts would quietly rewrite an international number's own
    // separators.
    return raw;
  }

  const formatted = `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
  return extension === null ? formatted : `${formatted} ext. ${extension}`;
}

/**
 * The same formatting for a value that may be absent, with a caller-chosen
 * placeholder — so a missing number reads as deliberately missing rather
 * than as a blank gap.
 */
export function formatPhoneNumberOr(value: string | null | undefined, fallback: string): string {
  const formatted = formatPhoneNumber(value);
  return formatted === '' ? fallback : formatted;
}
