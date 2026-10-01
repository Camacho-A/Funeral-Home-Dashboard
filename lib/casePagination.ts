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

type WixCaseCursorPayload = { v: 1; kind: 'wix'; organizationId: string; searchQuery: string; stage: string | null; wixCursor: string };
type MockCaseCursorPayload = { v: 1; kind: 'mock'; organizationId: string; searchQuery: string; stage: string | null; offset: number };

/** The application-level pagination cursor — opaque to every caller
    (UI components included; see route.ts's own comment on why the raw Wix
    cursor is never handed to the client directly). Carries its own
    issuing context (`organizationId`, `searchQuery`, `stage` — Case list
    scalability, Phase 2: every query dimension that determines the result
    set) so a cursor minted for one query can never be replayed against a
    different one — see validateCaseCursor below, the actual enforcement
    point. */
export type CaseCursorPayload = WixCaseCursorPayload | MockCaseCursorPayload;

/**
 * Case list scalability, Phase 3 (2026-09): this module is now imported
 * from BROWSER code too (services/casesService.ts's mock-mode
 * `listPage`/`counts` — mock mode has always run client-side, never
 * through this route, so it needs the exact same cursor contract
 * locally). `Buffer` doesn't exist in a browser bundle, so encode/decode
 * use `TextEncoder`/`TextDecoder` + `btoa`/`atob` instead — both are
 * standard globals in every environment this module now runs in (modern
 * Node and every browser), unlike `Buffer`. Output is byte-for-byte the
 * same base64url alphabet Phase 1/2 already used, so no previously-issued
 * cursor format changes.
 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeCaseCursor(payload: CaseCursorPayload): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

/** Never throws — a malformed/tampered/foreign-format token simply decodes
    to `null`, which callers must treat as "reject this request" rather
    than guessing at a fallback. */
export function decodeCaseCursor(token: string): CaseCursorPayload | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(token)));
    if (!parsed || typeof parsed !== 'object') return null;
    const p = parsed as Record<string, unknown>;
    if (p.v !== 1 || typeof p.organizationId !== 'string' || typeof p.searchQuery !== 'string') return null;
    if (p.stage !== null && typeof p.stage !== 'string') return null;
    const stage = (p.stage as string | null) ?? null;
    if (p.kind === 'wix' && typeof p.wixCursor === 'string') {
      return { v: 1, kind: 'wix', organizationId: p.organizationId, searchQuery: p.searchQuery, stage, wixCursor: p.wixCursor };
    }
    if (p.kind === 'mock' && typeof p.offset === 'number' && Number.isInteger(p.offset) && p.offset >= 0) {
      return { v: 1, kind: 'mock', organizationId: p.organizationId, searchQuery: p.searchQuery, stage, offset: p.offset };
    }
    return null;
  } catch {
    return null;
  }
}

export type CaseCursorValidation = { ok: true; payload: CaseCursorPayload } | { ok: false };

/**
 * The one place a cursor is trusted. Beyond decoding, this re-checks the
 * cursor's own embedded `organizationId`/`searchQuery`/`stage`/`kind`
 * against the CURRENT request's server-derived values — never the
 * reverse. This is defense-in-depth, not the only guard against
 * cross-tenant leakage: the Wix/mock query this cursor feeds into always
 * re-applies the server-derived `organizationId` filter regardless of
 * what a cursor claims, so even a forged cursor that somehow passed this
 * check could still never surface another organization's cases — but
 * rejecting it here means a tampered/foreign cursor, or one minted for a
 * different stage/search query, fails fast and explicitly (400), rather
 * than silently producing an empty or mismatched page (or, per Wix's own
 * documented cursor-paging contract, silently continuing the ORIGINAL
 * filter a cursor was minted with while the caller believes a new one
 * applied — see route.ts's own comment on this).
 */
export function validateCaseCursor(
  token: string,
  context: { organizationId: string; searchQuery: string; stage: string | null; kind: 'wix' | 'mock' },
): CaseCursorValidation {
  const payload = decodeCaseCursor(token);
  if (!payload) return { ok: false };
  if (payload.organizationId !== context.organizationId) return { ok: false };
  if (payload.searchQuery !== context.searchQuery) return { ok: false };
  if (payload.stage !== context.stage) return { ok: false };
  if (payload.kind !== context.kind) return { ok: false };
  return { ok: true, payload };
}

/**
 * Case list scalability, Phase 2 (2026-09) — server-side search. The exact
 * field set `services/casesService.ts#matchesSearch` has always checked,
 * preserved verbatim here so no existing searchable field is silently
 * dropped.
 *
 * IMPORTANT LIMITATION (investigated, not assumed): Wix Data's filter
 * grammar (the WQL shared by queryDataItems/countDataItems — see
 * https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/data-retrieval/about-the-wix-api-query-language)
 * has no `$contains`/substring operator at all for Text fields — only
 * `$startsWith` (documented "not case-sensitive"), plus equality/
 * comparison/`$in`/`$isEmpty`. `matchesSearch`'s real, current behavior is
 * substring-anywhere (`.includes()`), which is NOT representable in a
 * single efficient Wix query without either (a) switching to Wix's
 * separate, tokenized full-text Search Data Items endpoint — a different
 * endpoint with unverified cursor-pagination parity with the
 * queryDataItems-based contract this module already established and
 * live-verified in Phase 1, or (b) a maintained/normalized searchable
 * field (a schema change, explicitly out of scope this phase without
 * approval). `$startsWith` is therefore the safest available
 * approximation without a schema change — REPORTED, not silent: this
 * preserves case-insensitive prefix search on every existing field
 * exactly, but narrows `decedentName` specifically — searching a last
 * name that isn't the first word of a stored "FIRST LAST"-shaped name
 * (e.g. "MORALES" against "EMMA MORALES SILVA") no longer matches,
 * where the old substring search would have. See the Phase 2 report for
 * the full analysis and recommended follow-up.
 */
export const CASE_SEARCHABLE_FIELDS = ['decedentName', 'caseNumber', 'nextOfKinPhone', 'nextOfKinEmail', 'tagNumber', 'id'] as const;

type SearchableCaseFields = {
  decedentName: string;
  caseNumber: string;
  nextOfKinPhone: string;
  nextOfKinEmail: string | null;
  tagNumber: string | null;
  id: string;
};

function startsWithCaseInsensitive(value: string | null | undefined, query: string): boolean {
  return typeof value === 'string' && value.toLowerCase().startsWith(query);
}

/** The mock-mode equivalent of buildCaseSearchWixFilter below — kept as a
    case-insensitive $startsWith-per-field match (never `.includes()`) so
    mock mode never behaves more permissively than the real Wix query it
    stands in for; see this module's own top-of-search comment for why. */
export function matchesSearchStartsWith(case_: SearchableCaseFields, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return CASE_SEARCHABLE_FIELDS.some((field) => startsWithCaseInsensitive(case_[field], q));
}

/**
 * The raw Wix `cases` collection field name for each domain-level
 * searchable field above — see lib/wixCaseMapper.ts's own documented
 * rename table. Every field here is unchanged (`decedentName`,
 * `caseNumber`, `nextOfKinPhone`, `nextOfKinEmail`, `tagNumber`) EXCEPT
 * `id`, which Wix stores as `beaconCaseId` (`Case.id` is a mapper-level
 * rename, never the collection's own field name) — building a Wix filter
 * directly off `CASE_SEARCHABLE_FIELDS`' domain names without this
 * translation would silently filter on a field Wix doesn't have.
 */
const CASE_SEARCHABLE_WIX_FIELD_NAME: Record<(typeof CASE_SEARCHABLE_FIELDS)[number], string> = {
  decedentName: 'decedentName',
  caseNumber: 'caseNumber',
  nextOfKinPhone: 'nextOfKinPhone',
  nextOfKinEmail: 'nextOfKinEmail',
  tagNumber: 'tagNumber',
  id: 'beaconCaseId',
};

/** Builds the Wix WQL `$or` fragment for server-side search, or `null` for
    a blank query (no search filter to add at all). `$startsWith` is
    documented case-insensitive, so `query` is only trimmed, never
    lowercased — Wix does that itself. */
export function buildCaseSearchWixFilter(query: string): Record<string, unknown> | null {
  const q = query.trim();
  if (!q) return null;
  return {
    $or: CASE_SEARCHABLE_FIELDS.map((field) => ({ [CASE_SEARCHABLE_WIX_FIELD_NAME[field]]: { $startsWith: q } })),
  };
}

/**
 * Case list scalability, Phase 2 (2026-09). The one place the `cases`
 * collection's Wix filter is assembled — used identically by GET
 * /api/cases (list) and GET /api/cases/counts, so the two can never
 * silently diverge on what "this stage, this search" actually means.
 * `organizationId`/`isArchived: false` are always bare equality (matching
 * this codebase's existing filter convention exactly — see Phase 1's own
 * `{ organizationId, isArchived: false }` literal). `rawStages` filters on
 * `currentStage` — the Wix collection's own field name for what the
 * mapper renames to `Case.rawStage` (see lib/wixCaseMapper.ts's own
 * documented rename table; filtering on a literal `rawStage` field would
 * silently match nothing, since Wix has no such field). Both `currentStage`/
 * search are only added when actually requested, so a plain all-cases,
 * no-search request produces the exact same filter shape Phase 1 already
 * shipped and already has passing tests against.
 */
export function buildCaseListWixFilter(params: {
  organizationId: string;
  rawStages: number[] | null;
  searchFilter?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const base: Record<string, unknown> = { organizationId: params.organizationId, isArchived: false };
  if (params.rawStages) base.currentStage = { $in: params.rawStages };
  if (!params.searchFilter) return base;
  return { $and: [base, params.searchFilter] };
}
