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

import { getRegisteredOrganizationProfile, hasRegisteredOrganizationProfile } from '../organization/organizationProfiles';

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

function normalizedValidPrefix(prefix: string | null | undefined): string | null {
  if (typeof prefix !== 'string') return null;
  const trimmed = prefix.trim().toUpperCase();
  return isValidCaseNumberPrefix(trimmed) ? trimmed : null;
}

/**
 * THE single source of truth for which prefix an organization's case
 * numbers carry. Resolution order:
 *   1. the organization record's own `caseNumberPrefix` (when valid);
 *   2. `profileDefault`, when the caller already has one;
 *   3. the organization-profile registry's default for `organizationId`
 *      (or the record's own `id`) — domain/organization/
 *      organizationProfiles.ts (Manors 'B', Gus Camacho 'M'), so a record
 *      that predates the field can never silently fall back to another
 *      organization's prefix;
 *   4. `DEFAULT_CASE_NUMBER_PREFIX` ('B') — legacy backward compatibility
 *      only, for organizations that predate configurable prefixes.
 */
export function resolveCaseNumberPrefix(
  organization: { id?: string | null; caseNumberPrefix?: string | null } | null | undefined,
  options: { organizationId?: string | null; profileDefault?: string | null } = {},
): string {
  const fromRecord = normalizedValidPrefix(organization?.caseNumberPrefix);
  if (fromRecord) return fromRecord;
  const fromProfile = normalizedValidPrefix(options.profileDefault);
  if (fromProfile) return fromProfile;
  const orgId = options.organizationId ?? organization?.id ?? null;
  if (orgId && hasRegisteredOrganizationProfile(orgId)) {
    const fromRegistry = normalizedValidPrefix(getRegisteredOrganizationProfile(orgId).caseNumberPrefix);
    if (fromRegistry) return fromRegistry;
  }
  return DEFAULT_CASE_NUMBER_PREFIX;
}

function caseNumberPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}(\\d{4})-(\\d{3,})$`);
}

const ANY_PREFIX_CASE_NUMBER_PATTERN = /^([A-Z]{1,3})(\d{4})-(\d{3,})$/;

/**
 * Prefix-agnostic parse — for display-only code (e.g. a compact chip
 * label) that must work for any organization's numbers without assuming
 * "B". Never use this to decide whether a number belongs to an
 * organization; use `parseCaseNumber(value, prefix)` for that.
 */
export function parseAnyCaseNumber(value: string): { prefix: string; year: number; sequence: number } | null {
  const match = ANY_PREFIX_CASE_NUMBER_PATTERN.exec(value);
  if (!match) return null;
  return { prefix: match[1], year: Number(match[2]), sequence: Number(match[3]) };
}

/** True when `caseNumber` is a well-formed number carrying exactly
    `prefix` — the prefix-aware membership check used to refuse a number
    minted for a different organization's numbering scheme. */
export function caseNumberMatchesPrefix(caseNumber: string, prefix: string): boolean {
  return isValidCaseNumberPrefix(prefix) && parseCaseNumber(caseNumber, prefix) !== null;
}

/**
 * Builds `{prefix}{year}-{sequence}`, e.g. `formatCaseNumber(2026, 58)` ->
 * `"B2026-058"`, `formatCaseNumber(2026, 1, 'M')` -> `"M2026-001"`. `sequence` is always rendered as exactly 3 digits
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
  if (typeof value !== 'string') return null;
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
