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

/** First two characters, uppercased — the prototype's own avatar-initials
    convention (e.g. design/support.js's `raw.owner.slice(0,2).toUpperCase()`
    for case-owner avatars), reused here for any name-to-initials need. */
export function initialsFromName(name: string): string {
  return name.slice(0, 2).toUpperCase();
}
