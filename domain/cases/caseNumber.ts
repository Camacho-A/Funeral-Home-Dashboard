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
 * per-year-per-organization sequence are Beacon/Manor Cremations/Gus
 * Camacho business rules, not something any app with a date field would
 * want.
 */

const BEACON_CASE_NUMBER_PREFIX = 'B';
const CASE_NUMBER_PATTERN = /^B(\d{4})-(\d{3})$/;

/**
 * Builds `B{year}-{sequence}`, e.g. `formatCaseNumber(2026, 58)` ->
 * `"B2026-058"`. `sequence` is always rendered as exactly 3 digits
 * (`padStart`) — this is a display/format rule only; it does not cap the
 * actual sequence value (a 4-digit sequence in a busy year still renders
 * as e.g. "1000", not silently truncated).
 */
export function formatCaseNumber(year: number, sequence: number): string {
  return `${BEACON_CASE_NUMBER_PREFIX}${year}-${String(sequence).padStart(3, '0')}`;
}

/**
 * Parses a Case Number back into its year and sequence, or returns null if
 * `value` doesn't match the `B{YYYY}-{###+}` shape at all (used for
 * mock-mode sequence derivation — see services/casesService.ts — and could
 * back a future "search recognizes this looks like a case number" without
 * inventing a second parser).
 */
export function parseCaseNumber(value: string): { year: number; sequence: number } | null {
  const match = CASE_NUMBER_PATTERN.exec(value);
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
