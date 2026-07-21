import type { Case } from '../../types/case';
import type { ChecklistItemViewModel } from '../../types/caseViewModel';
import { STAGES, LAST_DISPLAY_STAGE } from './stages';

/**
 * "Completed" is only shown once ashes are actually confirmed picked up —
 * ported from design/support.js's buildCase(), which falls back to the
 * prior stage's label otherwise. `checklist` is the checklist already built
 * for the case's raw display stage (its first item is "Family picked up
 * ashes" at the terminal stage — see domain/cases/checklist.ts).
 */
export function resolveEffectiveDisplayStage(
  displayStage: number,
  checklist: ChecklistItemViewModel[],
): number {
  const isLastStage = displayStage === LAST_DISPLAY_STAGE;
  const ashesPickedUp = checklist[0]?.done ?? false;
  return isLastStage && !ashesPickedUp ? displayStage - 1 : displayStage;
}

export function stageLabelFor(displayStage: number): string {
  return STAGES[displayStage];
}

/**
 * A case advances exactly one raw stage at a time (the dashboard's bulk
 * "Advance N to next stage" action), which also resets the stage-entry
 * clock. Returns the patch a caller (useCaseMutations, Phase 6) applies via
 * casesService.update — this module only decides *what* changes, not how
 * it's persisted.
 */
export function advanceToNextStage(case_: Case): Pick<Case, 'rawStage' | 'daysWaitingInStage'> {
  return {
    rawStage: case_.rawStage + 1,
    daysWaitingInStage: 0,
  };
}
