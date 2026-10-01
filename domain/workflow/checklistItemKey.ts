import type { Case } from '../../types/case';
import type { CaseWorkflowSnapshot } from '../../types/workflowTemplate';

/**
 * B2026-035 (2026-10, checklist index-collision over-advancement). Root
 * cause: Case.checklistState used to be a flat `Record<number, boolean>`
 * keyed only by each item's position *within its own stage's checklist* —
 * with no stage information at all. Two different stages routinely reuse
 * the same local index for their own, unrelated last item (e.g. "Permit &
 * Authorization" and "DC Application Sent" each have exactly 2 items, so
 * both have a "local index 1"), so completing one stage's item could read
 * as if it also completed a different stage's item at the same index —
 * which is exactly what caused computeFirstIncompleteRawStage to silently
 * skip a stage.
 *
 * The fix: every checklistState entry is now stored under a composite
 * `"{displayStage}:{index}"` key — scoped by `displayStage`, not
 * `rawStage`. This distinction matters: Managed Cremations' First Call
 * (rawStage 0) and Payment (rawStage 1) are two different StageTemplate
 * entries that deliberately share one `displayStage` (0) and one
 * identical, combined checklist item list — scoping by `rawStage` would
 * have split that intentionally-shared checklist in two, forcing staff to
 * re-complete First Call items once a case's rawStage ticks forward to
 * Payment. `displayStage` is exactly "which checklist/stepper dot is
 * this" — the one unit two different rawStage values are allowed to
 * legitimately share — so scoping by it fixes the Permit/DC Application
 * Sent collision (different displayStage values) while preserving the
 * First Call/Payment sharing (same displayStage value) unchanged.
 *
 * Chosen over a nested per-stage shape (e.g. `{"3": {"1": true}}`)
 * because every existing write site already does a flat shallow-spread
 * merge (`{...checklistState, [key]: value}`); a flat composite key keeps
 * that exact pattern unchanged everywhere, while a nested shape would
 * require a deeper merge at every call site for no corresponding benefit.
 * No Wix schema change is required either way — Wix only validates that
 * checklistState is a plain object, never its internal key shape.
 *
 * displayStage + local index (rather than a separate, stable per-item id)
 * is a sufficient identity here because a case's own `workflowSnapshot` is
 * a one-time structuredClone taken at case creation and never reassigned
 * afterward (confirmed across services/casesService.ts, app/api/cases/
 * route.ts, and the Wix mapper/mock fixtures) — so a case's own item
 * positions, and the displayStage each belongs to, are permanently stable
 * for that case's lifetime regardless of later live-template edits. A
 * separate stable item id would only earn its keep if an existing case's
 * own snapshot could be reordered in place, which this architecture never
 * does.
 */
export function checklistItemKey(displayStage: number, index: number): string {
  return `${displayStage}:${index}`;
}

/**
 * Reads a checklist item's explicitly-persisted value, or `undefined` if
 * nothing is recorded for it (the caller falls back to `defaultDone`).
 *
 * Legacy data (written before this fix) only ever has a bare numeric key
 * — e.g. `{"1": true}` — with no stage information. Such a value can only
 * be confidently attributed to whichever display stage the checklist-
 * editing UI was actually showing at write time, which was always the
 * case's *current* display stage (`currentDisplayStage`) — the checklist
 * UI has never let staff edit a past or future stage's items (see
 * ChecklistCard.tsx's own read-only-when-viewing-a-past-stage behavior).
 * For any other display stage, a bare legacy key is fundamentally
 * ambiguous — it might belong to this stage, or to any other stage that
 * happens to share the same local index — and must never be guessed; this
 * deliberately returns `undefined` (not the legacy value) for every
 * display stage except the case's current one, which is itself exactly
 * the B2026-035 bug restated as a rule: "do not assume a bare index
 * belongs to a stage it wasn't written against."
 */
export function readChecklistValue(
  checklistState: Case['checklistState'],
  displayStage: number,
  index: number,
  currentDisplayStage: number,
): boolean | undefined {
  const scopedValue = checklistState[checklistItemKey(displayStage, index)];
  if (scopedValue !== undefined) return scopedValue;

  if (displayStage === currentDisplayStage) {
    return checklistState[String(index)];
  }
  return undefined;
}

/** Builds the patch value for setting one stage-scoped item, preserving
    every other existing entry (composite or legacy) unchanged. */
export function writeChecklistValue(
  checklistState: Case['checklistState'],
  displayStage: number,
  index: number,
  value: boolean,
): Case['checklistState'] {
  return { ...checklistState, [checklistItemKey(displayStage, index)]: value };
}

/** True for a composite `"{displayStage}:{index}"` key, false for a bare
    legacy numeric key (`"3"`) or any non-numeric-prefixed string. */
export function isCompositeChecklistKey(key: string): boolean {
  return /^\d+:\d+$/.test(key);
}

/**
 * Every bare (pre-migration) legacy key present in a case's checklistState.
 * `readChecklistValue` only ever reinterprets one of these — the one
 * matching the case's *current* display stage, at read time — so every
 * other entry in this list is a value the live app now permanently
 * ignores (never deleted, just never read again). Exposed for the
 * read-only organization-wide audit and for a future human-review tool;
 * never consulted by resolveChecklist/computeFirstIncompleteRawStage
 * itself.
 */
export function findLegacyChecklistKeys(case_: Case): string[] {
  return Object.keys(case_.checklistState).filter((key) => !isCompositeChecklistKey(key));
}

export type ChecklistStatePatchValidationError = { key: string; reason: string };

/**
 * B2026-035 hardening (2026-10): server-side guard so no write path can
 * ever CREATE new ambiguous checklist state again — reads still tolerate
 * legacy bare keys during the migration window (`readChecklistValue`
 * above), but a write must not introduce one.
 *
 * Only validates entries that are actually NEW or CHANGING relative to
 * `previousChecklistState` — hooks/useCaseMutations.ts always sends the
 * full map (`{...case_.checklistState, [key]: value}`), so an existing
 * case that still carries a pre-migration bare key would otherwise fail
 * every single edit, including ones unrelated to that stale key, simply
 * for carrying it forward unchanged. "Do not create new ambiguity" and
 * "do not brick every edit on a not-yet-migrated case" are both satisfied
 * by only enforcing the canonical format on what this patch is actually
 * writing.
 *
 * For each new/changed entry, validates: the value is a boolean; the key
 * matches the canonical `"{displayStage}:{index}"` format; both numbers
 * are non-negative integers; and — whenever a `workflowSnapshot` is
 * available — that a stage with that `displayStage` and an item at that
 * `index` actually exist in it, not just that the key is shaped
 * correctly. Returns an empty array when the patch is fully valid.
 */
export function findInvalidChecklistStatePatchEntries(
  previousChecklistState: Case['checklistState'],
  patchChecklistState: Case['checklistState'],
  workflowSnapshot: CaseWorkflowSnapshot | null,
): ChecklistStatePatchValidationError[] {
  const errors: ChecklistStatePatchValidationError[] = [];

  for (const [key, value] of Object.entries(patchChecklistState)) {
    if (previousChecklistState[key] === value) continue; // carried forward unchanged — not a new write

    if (typeof value !== 'boolean') {
      errors.push({ key, reason: 'checklist value must be a boolean' });
      continue;
    }

    const match = /^(\d+):(\d+)$/.exec(key);
    if (!match) {
      errors.push({ key, reason: 'checklist key must use the canonical "{displayStage}:{index}" format' });
      continue;
    }

    const displayStage = Number(match[1]);
    const index = Number(match[2]);
    if (!Number.isInteger(displayStage) || displayStage < 0 || !Number.isInteger(index) || index < 0) {
      errors.push({ key, reason: 'displayStage and index must both be non-negative integers' });
      continue;
    }

    if (workflowSnapshot) {
      const stage = workflowSnapshot.stages.find((s) => s.displayStage === displayStage);
      const item = stage?.checklist.items.find((candidate) => candidate.index === index);
      if (!stage || !item) {
        errors.push({ key, reason: `no checklist item at displayStage ${displayStage}, index ${index} exists in this case's workflow snapshot` });
      }
    }
  }

  return errors;
}
