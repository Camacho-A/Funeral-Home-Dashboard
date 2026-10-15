/**
 * Phase 16B (Case Number Generation). The single source of truth for the
 * Case Number format — every caller that builds or parses one (mock
 * generation in services/casesService.ts, real generation in
 * lib/wixCaseNumberSequence.ts, and any future report/export/notification)
 * imports this module rather than re-deriving the format itself. See
 * docs/adr/ADR-018-case-number-generation.md.
 *
 * This is a funeral-home business identifier, not a generic string-
 * formatting utility, which is why it lives in domain/ rather than utils/
 * (see docs/adr/ADR-004-domain-layer.md) — the "B" prefix and 3-digit,
 * per-year-per-organization sequence are Solis/Manor Cremations/Gus
 * Camacho business rules, not something any app with a date field would
 * want.
 */

/**
 * The prefix an organization's case numbers carry.
 *
 * `'B'` is Manors' and stays the default, so every existing case number,
 * stored row and caller is unaffected. A second funeral home is a
 * different business with its own filing conventions, and inheriting
 * another's prefix would be an accident rather than a decision — so the
 * prefix is configurable per organization (`Organization.caseNumberPrefix`)
 * rather than a constant.
 *
 * Constrained to 1-3 letters: it has to stay recognisable at a glance on
 * a case list, and the pattern below has to be able to parse it back.
 */
export const DEFAULT_CASE_NUMBER_PREFIX = 'B';

export function isValidCaseNumberPrefix(prefix: string): boolean {
  return /^[A-Z]{1,3}$/.test(prefix);
}

/** Resolves an organization's prefix, falling back to the default for an
    organization that has never set one — which is every organization that
    existed before this was configurable. */
export function caseNumberPrefixFor(prefix: string | null | undefined): string {
  const trimmed = (prefix ?? '').trim().toUpperCase();
  return isValidCaseNumberPrefix(trimmed) ? trimmed : DEFAULT_CASE_NUMBER_PREFIX;
}

function caseNumberPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}(\\d{4})-(\\d{3,})$`);
}

/**
 * Builds `B{year}-{sequence}`, e.g. `formatCaseNumber(2026, 58)` ->
 * `"B2026-058"`. `sequence` is always rendered as exactly 3 digits
 * (`padStart`) — this is a display/format rule only; it does not cap the
 * actual sequence value (a 4-digit sequence in a busy year still renders
 * as e.g. "1000", not silently truncated).
 */
export function formatCaseNumber(year: number, sequence: number, prefix?: string | null): string {
  return `${caseNumberPrefixFor(prefix)}${year}-${String(sequence).padStart(3, '0')}`;
}

/**
 * Parses a Case Number back into its year and sequence, or returns null if
 * `value` doesn't match the `B{YYYY}-{###+}` shape at all (used for
 * mock-mode sequence derivation — see services/casesService.ts — and could
 * back a future "search recognizes this looks like a case number" without
 * inventing a second parser).
 */
export function parseCaseNumber(value: string, prefix?: string | null): { year: number; sequence: number } | null {
  const match = caseNumberPattern(caseNumberPrefixFor(prefix)).exec(value);
  if (!match) return null;
  return { year: Number(match[1]), sequence: Number(match[2]) };
}

/**
 * Runtime backstop against a caseNumber ever reaching an update patch —
 * types/case.ts's CaseUpdate already excludes `caseNumber` at compile time
 * (the same two-layer guarantee this project already uses for
 * intakeOwnerId; see domain/cases/intakeOwnership.ts's own comment on why
 * a type-only guarantee isn't enough for a plain JS object spread reached
 * via an `as any` cast). services/casesService.ts's mock-mode update()
 * calls this before applying any patch; the Wix-mode PATCH route doesn't
 * need it since app/api/cases/[caseId]/route.ts never includes
 * `caseNumber` in validateAndPickCaseUpdate's allowlist at all.
 */
export function assertCaseNumberUnchanged(patch: unknown): void {
  if (patch !== null && typeof patch === 'object' && 'caseNumber' in patch) {
    throw new Error('caseNumber cannot be changed after a case is created');
  }
}

/**
 * Manors launch-prep — P0 automatic case numbering. Which calendar year a
 * new case's number belongs to, in the organization's own local timezone
 * — never blindly `new Date().getFullYear()` (server/UTC time), so a case
 * created shortly after local midnight on January 1st gets the new year's
 * prefix even before UTC has rolled over (and, symmetrically, a case
 * created late on December 31st local time never jumps the gun into next
 * year just because UTC already has). Same hand-rolled, no-new-dependency
 * `Intl.DateTimeFormat` technique `domain/notifications/digestTiming.ts`'s
 * `orgLocalTime` already established for org-local time-of-day — `year:
 * 'numeric'` is the one addition needed here. UTC fallback for any
 * organization predating the optional `timezone` field, exactly like that
 * same precedent.
 */
export function orgLocalYear(nowIso: string, timezone: string | undefined): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    timeZone: timezone || 'UTC',
  }).format(new Date(nowIso));
  return Number(formatted);
}
