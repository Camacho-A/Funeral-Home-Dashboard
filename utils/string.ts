/**
 * Generic, domain-independent string helper — not a business rule, unlike
 * everything in domain/ (see docs/adr/ADR-004-domain-layer.md). Added now
 * because domain/cases/timeline.ts needs it; format.ts/print.ts follow once
 * something actually needs them (Phase 6).
 */

/** Lowercases the first letter, except when the string starts with a
    multi-letter acronym (e.g. "ME release received" stays capitalized) —
    ported from design/support.js's lowerFirst. */
export function lowerFirst(label: string): string {
  if (/^[A-Z]{2,}/.test(label)) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** Employee initials derived from their actual first and last name — the
    first letter of the first word plus the first letter of the last word
    (e.g. "Angelica Camacho" -> "AC"). Deliberately NOT a raw slice of the
    first N characters of the whole string (that previous convention
    produced "AN" for "Angelica Camacho" — the first two letters of just
    the first name — which is wrong whenever a last name is available).
    A single-word name (no last name available) falls back to that word's
    own initial only, never inventing a second letter from anything else. */
export function initialsFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const firstInitial = words[0][0];
  const lastInitial = words.length > 1 ? words[words.length - 1][0] : '';
  return (firstInitial + lastInitial).toUpperCase();
}

/**
 * SOLIS true redesign, Phase 1 — visual fidelity correction (2026-10).
 * Presentation-only title-case for a stored name (e.g. the typography
 * spec's own example: "LOUIS BARBER" renders as "Louis Barber"). Never
 * writes anything back — call sites pass the stored value straight
 * through to this at render time; the underlying record (decedentName,
 * etc.) is never touched. Capitalizes after spaces and hyphens so a
 * hyphenated name reads correctly too (e.g. "MARY-JANE O'BRIEN" ->
 * "Mary-Jane O'Brien"); apostrophes are left as plain word-internal
 * characters, matching how this already-simple helper treats any other
 * mid-word character.
 */
export function toDisplayTitleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_match, boundary: string, letter: string) => boundary + letter.toUpperCase());
}

/**
 * Invitation email organization-name casing (2026-10). Presentation-only,
 * same "never writes anything back, call site passes the stored value
 * straight through at render time" posture as `toDisplayTitleCase` above
 * — reuses that exact algorithm once gated by the all-caps check below.
 *
 * Deliberately narrower than `toDisplayTitleCase`: only acts when the
 * value has NO lowercase letters at all. A value that already has even
 * one intentionally-cased letter (a stylized brand name, an acronym
 * spelled with lowercase elsewhere, an apostrophe-cased name) is left
 * completely untouched — there is no reliable way to tell "entirely
 * uppercase by data-entry habit" (e.g. "MANORS CREMATION") apart from
 * "genuinely all-caps by design" from the stored string alone, so this
 * only acts on the unambiguous case and never touches anything already
 * mixed-case. A value with no letters at all (nothing to normalize) is
 * also left untouched.
 */
export function toDisplayCasingIfAllCaps(value: string): string {
  const hasLowercase = /[a-z]/.test(value);
  const hasUppercase = /[A-Z]/.test(value);
  if (hasLowercase || !hasUppercase) return value;
  return toDisplayTitleCase(value);
}
