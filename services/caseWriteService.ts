import { queryWixDataItems, conditionalPatchWixDataItemFields } from '../lib/wixDataApi';
import { caseRevision, caseWriteCondition, mapWixCaseItem, storedCaseRevision, type WixCaseItem } from '../lib/wixCaseMapper';
import { caseFixtures } from './__mocks__/fixtures';
import type { Case } from '../types/case';

/**
 * Case concurrency (2026-10). The ONE way a `cases` row is changed after it
 * is created. Every update path — the case PATCH, automatic archiving,
 * workflow reconciliation and marking a case paid — goes through
 * `writeCaseFields` (one attempt) or `updateCaseWithRetry` (re-read and
 * re-decide on conflict). See docs/CASE_CONCURRENCY.md.
 *
 * Before this, each of them read the case, merged its change onto that read
 * and sent the WHOLE row back (a full replace with no precondition), so any
 * write landing in between was silently undone — a payment tick erased by a
 * checkbox click, a stage advance undone by a name edit. Two rules close it:
 *
 *  1. FIELD-SCOPED. A write sets only the fields its operation changes
 *     (Wix PatchDataItem, one `SET_FIELD` per field).
 *  2. OPTIMISTIC CONCURRENCY. Every write also sets `revision` to the read
 *     revision + 1, conditioned on `revision` still being the read value
 *     (plus `organizationId` and `beaconCaseId`, so a write can never land
 *     on another organization's row). A legacy row with no `revision` is
 *     matched with `$eq: null`, so no migration is needed. If another write
 *     landed first, Wix refuses the whole patch (HTTP 428) and nothing is
 *     written.
 *
 * This is the same field, condition and write shape Gus SOLIS uses on the
 * same shared rows, so each app's writes are visible to the other's
 * revision checks.
 *
 * A response lost AFTER the patch applied is not a failure: the row is
 * re-read and, when it is at exactly the next revision with every field this
 * write set, the write is reported as applied.
 */

export type LoadedCaseRow = { id: string; data: WixCaseItem; case_: Case };

export type CaseWriteResult =
  | { result: 'applied'; case_: Case; row: LoadedCaseRow }
  /** Another write landed first. `current` is the row as it is now (null if
      it could not be re-read). */
  | { result: 'conflict'; current: LoadedCaseRow | null }
  | { result: 'not_found' }
  | { result: 'failed'; status: number; reason: string };

/** Loads one case row by its Solis id, scoped to `organizationId`. A row
    another organization owns is "not found", never returned. */
export async function loadCaseRow(organizationId: string, caseId: string): Promise<LoadedCaseRow | null> {
  const response = await queryWixDataItems<WixCaseItem>('cases', {
    filter: { beaconCaseId: caseId, organizationId },
    paging: { limit: 1 },
  });
  const item = response.dataItems[0];
  const case_ = item ? mapWixCaseItem(item.data) : null;
  // Defense in depth: never trust the backend's filter alone.
  if (!item || !case_ || case_.organizationId !== organizationId || case_.id !== caseId) return null;
  return { id: item.id, data: item.data, case_ };
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * One field-scoped, revision-conditioned write against the row as it was
 * read. `fields` are Wix field names (lib/wixCaseMapper.ts's
 * buildCaseFieldPatch builds them from a CaseUpdate).
 */
export async function writeCaseFields(row: { id: string; data: WixCaseItem }, fields: Record<string, unknown>): Promise<CaseWriteResult> {
  const organizationId = row.data.organizationId as string;
  const caseId = row.data.beaconCaseId as string;
  const nextRevision = caseRevision(row.data) + 1;
  const toSet = { ...fields, revision: nextRevision };
  const condition = caseWriteCondition(row.data);

  let status = 0;
  let reason = 'the case could not be saved';
  try {
    const response = await conditionalPatchWixDataItemFields<WixCaseItem>('cases', row.id, toSet, condition);
    if (response.applied) {
      const data = { ...row.data, ...toSet, ...(response.dataItem?.data ?? {}) } as WixCaseItem;
      const case_ = mapWixCaseItem(data);
      if (case_) return { result: 'applied', case_, row: { id: row.id, data, case_ } };
      reason = 'the updated case could not be read back';
    } else {
      status = response.status;
      reason = `the case could not be saved (HTTP ${response.status})`;
    }
  } catch (error) {
    reason = error instanceof Error ? error.message : reason;
  }

  // Refused, failed or response lost: the row as it is NOW decides.
  const current = await loadCaseRow(organizationId, caseId).catch(() => undefined);
  if (current === null) return { result: 'not_found' };
  if (
    current &&
    storedCaseRevision(current.data) === nextRevision &&
    Object.entries(toSet).every(([key, value]) => sameValue((current.data as Record<string, unknown>)[key], value))
  ) {
    // Our patch landed; only its response was lost.
    return { result: 'applied', case_: current.case_, row: current };
  }
  if (status === 428 || status === 412) return { result: 'conflict', current: current ?? null };
  if (status === 404) return { result: 'not_found' };
  if (current && storedCaseRevision(current.data) !== storedCaseRevision(row.data)) {
    // The row moved, but not to exactly this write. Whether this write
    // applied is not knowable from here — report a failure, never "nothing
    // changed", so the caller re-reads instead of assuming either outcome.
    return { result: 'failed', status, reason: `${reason}; the case changed meanwhile, so whether this write applied could not be confirmed` };
  }
  return { result: 'failed', status, reason };
}

/** What a recompute decides from the case as it is now: the Wix fields to
    set, or null for "nothing to do". */
export type CaseFieldDecision = Record<string, unknown> | null;

export type CaseRetryResult =
  | { result: 'applied'; case_: Case; row: LoadedCaseRow }
  | { result: 'unchanged'; case_: Case; row: LoadedCaseRow }
  | { result: 'conflict'; current: LoadedCaseRow | null }
  | { result: 'not_found' }
  | { result: 'failed'; status: number; reason: string };

export const CASE_WRITE_MAX_ATTEMPTS = 3;

/**
 * Read → decide → conditional write, re-reading and deciding again when
 * another write landed first (at most CASE_WRITE_MAX_ATTEMPTS times, then
 * `conflict` — never an unbounded loop). Only for changes that are a pure
 * function of the case's CURRENT state (reconciliation, archiving, marking
 * paid): the decision is re-made from every fresh read, so a retry can never
 * re-apply a stale value. `first` reuses a row the caller already loaded.
 */
export async function updateCaseWithRetry(
  organizationId: string,
  caseId: string,
  decide: (row: LoadedCaseRow) => CaseFieldDecision | Promise<CaseFieldDecision>,
  options: { first?: LoadedCaseRow; maxAttempts?: number } = {},
): Promise<CaseRetryResult> {
  const maxAttempts = options.maxAttempts ?? CASE_WRITE_MAX_ATTEMPTS;
  let row: LoadedCaseRow | null = options.first ?? null;
  let lastConflict: LoadedCaseRow | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!row || attempt > 0) row = await loadCaseRow(organizationId, caseId);
    if (!row) return { result: 'not_found' };
    const decision = await decide(row);
    if (decision === null || Object.keys(decision).length === 0) return { result: 'unchanged', case_: row.case_, row };
    const written = await writeCaseFields(row, decision);
    if (written.result !== 'conflict') return written;
    lastConflict = written.current;
  }
  return { result: 'conflict', current: lastConflict };
}

// ---------------------------------------------------------------------------
// Mock mode — the same revision semantics against the in-memory fixtures.
// ---------------------------------------------------------------------------

/**
 * Mock counterpart of a conditional write: replaces the fixture with
 * `build(current)` and increments its revision. Returns null when the case
 * doesn't exist in this organization. Callers that hold a client revision
 * check it before calling (casesService.update).
 */
export function writeMockCase(organizationId: string, caseId: string, build: (current: Case) => Case): Case | null {
  const index = caseFixtures.findIndex((c) => c.id === caseId && c.organizationId === organizationId);
  if (index === -1) return null;
  const current = caseFixtures[index];
  const updated: Case = { ...build(current), revision: caseRevision(current) + 1 };
  caseFixtures[index] = updated;
  return updated;
}
