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
 * Reads ONLY the canonical composite key. The temporary legacy-bare-key
 * read fallback (which, during the migration window right after this fix
 * shipped, reinterpreted a bare `{"1": true}` as belonging to whichever
 * display stage was the case's current one at read time) has been
 * retired: the 2026-10 production migration converted every active
 * case's bare keys to composite form and a read-only organization-wide
 * scan confirmed zero cases still carry one. A bare key is now never
 * interpreted as checklist completion, for any stage, under any
 * circumstance — it simply isn't a recognized key shape anymore, and
 * `defaultDone` governs instead.
 */
export function readChecklistValue(
  checklistState: Case['checklistState'],
  displayStage: number,
  index: number,
): boolean | undefined {
  return checklistState[checklistItemKey(displayStage, index)];
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

/** The one canonical key shape — defined once so isCompositeChecklistKey
    and findInvalidChecklistStatePatchEntries can never drift apart. */
const COMPOSITE_KEY_PATTERN = /^(\d+):(\d+)$/;

/** True for a composite `"{displayStage}:{index}"` key, false for
    anything else (including a bare numeric string like `"3"`, which is
    no longer a recognized shape at all — see readChecklistValue's own
    doc comment). Used by the server-side write validator below. */
export function isCompositeChecklistKey(key: string): boolean {
  return COMPOSITE_KEY_PATTERN.test(key);
}

export type ChecklistStatePatchValidationError = { key: string; reason: string };

/**
 * B2026-035 hardening (2026-10): server-side guard so no write path can
 * ever write ambiguous checklist state. Only the canonical composite key
 * is a recognized shape — a bare key is rejected unconditionally (not
 * just "when it's new"; see below for the one carve-out).
 *
 * Only validates entries that are actually NEW or CHANGING relative to
 * `previousChecklistState` — hooks/useCaseMutations.ts always sends the
 * full map (`{...case_.checklistState, [key]: value}`), so if a case
 * somehow still carried a stale non-canonical key, re-sending it
 * unchanged on an unrelated edit must not brick that edit. The 2026-10
 * production migration converted every active case to composite keys and
 * a read-only scan confirmed zero remain, so this carve-out is not
 * expected to ever trigger in practice — it stays purely as a defensive
 * no-op guard, not a reopened compatibility window.
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

    const match = COMPOSITE_KEY_PATTERN.exec(key);
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
