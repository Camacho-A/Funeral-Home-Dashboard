import type { Case } from '../../types/case';
import type { ChecklistItemViewModel } from '../../types/caseViewModel';

/**
 * "Completed" is only shown once ashes are actually confirmed picked up —
 * ported from design/support.js's buildCase(), which falls back to the
 * prior stage's label otherwise. `checklist` is the checklist already built
 * for the case's raw display stage (its first item is "Family picked up
 * ashes" at the terminal stage — see domain/cases/checklist.ts).
 *
 * Phase 11: `lastDisplayStage` is now a parameter (from the case's own
 * workflowSnapshot, via domain/workflow/resolveStages.ts's
 * lastDisplayStage) instead of the hardcoded LAST_DISPLAY_STAGE constant —
 * this rule is applied uniformly to every template's own final stage, not
 * assumed to be Managed Cremations' specific 7-stage list. `stageLabelFor`
 * (which used to live here too) moved to domain/workflow/resolveStages.ts's
 * findStageByDisplayStage, since label lookup is now snapshot-driven.
 */
export function resolveEffectiveDisplayStage(
  displayStage: number,
  checklist: ChecklistItemViewModel[],
  lastDisplayStage: number,
): number {
  const isLastStage = displayStage === lastDisplayStage;
  const ashesPickedUp = checklist[0]?.done ?? false;
  return isLastStage && !ashesPickedUp ? displayStage - 1 : displayStage;
}

/**
 * A case advances exactly one raw stage at a time (the dashboard's bulk
 * "Advance N to next stage" action), which also resets the stage-entry
 * clock. Returns the patch a caller (useCaseMutations, Phase 6) applies via
 * casesService.update — this module only decides *what* changes, not how
 * it's persisted. Unchanged by Phase 11: every template in this codebase
 * uses sequential raw-stage numbering starting at 0 (see
 * docs/TEMPLATE_VERSIONING.md), so a plain +1 still lands on the next real
 * stage regardless of which template a case belongs to.
 */
export function advanceToNextStage(case_: Case): Pick<Case, 'rawStage' | 'daysWaitingInStage'> {
  return {
    rawStage: case_.rawStage + 1,
    daysWaitingInStage: 0,
  };
}
