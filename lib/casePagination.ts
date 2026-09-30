/**
 * Case list scalability, Phase 1 (2026-09). Shared pagination primitives for
 * GET /api/cases — kept independent of both the Wix adapter and the mock
 * fixtures so the SAME contract (opaque cursor, hasMore, deterministic
 * order) is exercised by both `DATA_ADAPTER=wix` and `DATA_ADAPTER=mock`,
 * per this phase's own requirement that dev mode never hide a pagination
 * bug production would hit.
 *
 * Root cause this phase fixes: `lib/wixDataApi.ts#queryWixDataItems` silently
 * caps an unpaginated query at 50 items (see that file's own comment on the
 * `rolePermissions` incident) — GET /api/cases called it with no `paging`
 * at all, so any organization with more than 50 non-deleted cases would
 * silently lose the rest, with no error and no signal to the caller. This
 * module is the pagination contract that replaces that single unbounded
 * call: a caller that wants everything still gets everything (via
 * `queryAllWixDataItems`'s existing cursor loop, unchanged from how
 * `rolePermissions` already fixed this same defect), and a caller that
 * wants a bounded page gets one, with an honest `hasMore`/`nextCursor`.
 */

export const CASE_LIST_DEFAULT_PAGE_SIZE = 50;
export const CASE_LIST_MAX_PAGE_SIZE = 200;

/**
 * Deterministic order for the bounded-page pagination mode only (never
 * applied to the legacy "fetch everything" mode — see route.ts's own
 * comment on why that mode is left at its historical, order-agnostic
 * shape). `createdAt` alone isn't safe as a cursor key: two cases created
 * in the same millisecond (two staff members, concurrent intake) would tie,
 * and a tied sort key can silently duplicate or drop rows across a cursor
 * boundary. `caseNumber` is guaranteed unique per organization (see
 * domain/cases/caseNumber.ts — atomically reserved, fixed-width
 * zero-padded sequence, so lexical order matches chronological order
 * within a year and across a year boundary) and is always present, making
 * it a safe secondary tiebreaker with zero extra schema/data requirements.
 */
export const CASE_LIST_SORT: Array<{ fieldName: string; order: 'ASC' | 'DESC' }> = [
  { fieldName: 'createdAt', order: 'DESC' },
  { fieldName: 'caseNumber', order: 'DESC' },
];

/** The mock-mode equivalent of CASE_LIST_SORT above — must stay logically
    identical (same fields, same direction) so the two modes page through
    fixtures/Wix data in the same order; kept as one exported comparator
    (rather than two independently-maintained sort expressions) so they
    cannot silently drift apart. */
export function compareCasesForListSort(a: { createdAt: string; caseNumber: string }, b: { createdAt: string; caseNumber: string }): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.caseNumber !== b.caseNumber) return a.caseNumber < b.caseNumber ? 1 : -1;
  return 0;
}

/** Clamps a caller-requested page size into [1, CASE_LIST_MAX_PAGE_SIZE],
    falling back to CASE_LIST_DEFAULT_PAGE_SIZE for anything absent/invalid
    — never trusts an arbitrary caller-supplied number directly into a Wix
    `paging.limit` (which would let a caller demand an unbounded page,
    defeating the point of bounded pagination). */
export function clampCaseListPageSize(requested: number | null): number {
  if (requested === null || !Number.isFinite(requested) || requested <= 0) return CASE_LIST_DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(requested), CASE_LIST_MAX_PAGE_SIZE);
}

type WixCaseCursorPayload = { v: 1; kind: 'wix'; organizationId: string; searchQuery: string; wixCursor: string };
type MockCaseCursorPayload = { v: 1; kind: 'mock'; organizationId: string; searchQuery: string; offset: number };

/** The application-level pagination cursor — opaque to every caller
    (UI components included; see route.ts's own comment on why the raw Wix
    cursor is never handed to the client directly). Carries its own
    issuing context (`organizationId`, `searchQuery`) so a cursor minted
    for one query can never be replayed against a different one — see
    validateCaseCursor below, the actual enforcement point. */
export type CaseCursorPayload = WixCaseCursorPayload | MockCaseCursorPayload;

export function encodeCaseCursor(payload: CaseCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Never throws — a malformed/tampered/foreign-format token simply decodes
    to `null`, which callers must treat as "reject this request" rather
    than guessing at a fallback. */
export function decodeCaseCursor(token: string): CaseCursorPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const p = parsed as Record<string, unknown>;
    if (p.v !== 1 || typeof p.organizationId !== 'string' || typeof p.searchQuery !== 'string') return null;
    if (p.kind === 'wix' && typeof p.wixCursor === 'string') {
      return { v: 1, kind: 'wix', organizationId: p.organizationId, searchQuery: p.searchQuery, wixCursor: p.wixCursor };
    }
    if (p.kind === 'mock' && typeof p.offset === 'number' && Number.isInteger(p.offset) && p.offset >= 0) {
      return { v: 1, kind: 'mock', organizationId: p.organizationId, searchQuery: p.searchQuery, offset: p.offset };
    }
    return null;
  } catch {
    return null;
  }
}

export type CaseCursorValidation = { ok: true; payload: CaseCursorPayload } | { ok: false };

/**
 * The one place a cursor is trusted. Beyond decoding, this re-checks the
 * cursor's own embedded `organizationId`/`searchQuery`/`kind` against the
 * CURRENT request's server-derived values — never the reverse. This is
 * defense-in-depth, not the only guard against cross-tenant leakage: the
 * Wix/mock query this cursor feeds into always re-applies the
 * server-derived `organizationId` filter regardless of what a cursor
 * claims, so even a forged cursor that somehow passed this check could
 * still never surface another organization's cases — but rejecting it
 * here means a tampered/foreign cursor fails fast and explicitly (400),
 * rather than silently producing an empty or mismatched page.
 */
export function validateCaseCursor(
  token: string,
  context: { organizationId: string; searchQuery: string; kind: 'wix' | 'mock' },
): CaseCursorValidation {
  const payload = decodeCaseCursor(token);
  if (!payload) return { ok: false };
  if (payload.organizationId !== context.organizationId) return { ok: false };
  if (payload.searchQuery !== context.searchQuery) return { ok: false };
  if (payload.kind !== context.kind) return { ok: false };
  return { ok: true, payload };
}
