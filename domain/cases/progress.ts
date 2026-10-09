import type { CaseWorkflowSnapshot } from '../../types/workflowTemplate';
import type { ChecklistItemViewModel } from '../../types/caseViewModel';
import { activeChecklistItemCount } from '../organization/checklistRetirement';
import { displayStagesInOrder } from '../workflow/resolveStages';

export type CaseProgress = {
  completedItems: number;
  totalItems: number;
  /** 0-100, whole number — see domain/cases/viewModel.ts's own comment for
      why this is never simply derived from the current stage's position. */
  percent: number;
};

/**
 * Case progress indicator (Case list scalability, Phase 3 — progress
 * indicator addition, 2026-09). The canonical "how much of this case's
 * ENTIRE workflow is actually done" calculation — completed checklist
 * items across every stage the case has already passed, plus the
 * current stage's own real (checklistState-backed) completion, divided
 * by the total checklist items across the whole workflow (including
 * stages not yet reached). Deliberately NOT derived from the stage
 * number/position alone — a case sitting in stage 6 of 8 does not
 * automatically read as "75%" just because of where it is; the
 * percentage only moves when checklist items actually get checked off.
 *
 * Reuses `displayStagesInOrder` rather than iterating `snapshot.stages`
 * directly — Managed Cremations' First Call (raw 0) and Payment (raw 1)
 * stages both carry an identical, fully-combined checklist item list
 * (see domain/cases/checklist.ts#getChecklistLabels: `rawStage <= 1`
 * returns the same combined array for either raw stage) since they
 * display as one single stepper dot/checklist. Summing `snapshot.stages`
 * directly would double-count that shared checklist for any case that
 * has passed through both raw stages; `displayStagesInOrder` collapses
 * them to the one StageTemplate the case/checklist UI actually shows.
 *
 * A stage strictly before the case's current DISPLAY stage is treated as
 * fully complete, unconditionally — the exact same trust assumption
 * domain/workflow/resolveChecklist.ts's own `isPastStage` flag already
 * encodes for Case Detail's read-only historical checklist view (see its
 * doc comment: "a stage the case has already moved beyond is complete by
 * definition"). This function doesn't invent a stricter rule than Case
 * Detail already applies, but it does mean a case whose stage was
 * advanced via the Dashboard's bulk "Advance to next stage" action
 * (domain/cases/transitions.ts#advanceToNextStage, which only patches
 * `rawStage` — it never checks or clears checklist completion) will read
 * as fully complete through every stage it was bulk-advanced past, even
 * if no checklist item in those stages was ever actually checked. That's
 * a pre-existing architectural trust assumption this function inherits,
 * not a new one it introduces — see this phase's own final report.
 *
 * `currentStageChecklist` must be the CURRENT stage's fully-resolved
 * checklist (every override already applied — the terminal return-of-
 * remains item, Family Contact presentation, legacy Certifier
 * presentation, …) so this can never disagree with what Case Detail
 * itself shows for that same stage; buildCaseViewModel already computes
 * exactly this value (`effectiveCurrentChecklist`) for its own `checklist`
 * field, so this takes it as a parameter rather than re-deriving a second,
 * un-overridden version via a raw resolveChecklist call.
 */
export function computeCaseProgress(
  snapshot: CaseWorkflowSnapshot,
  currentDisplayStage: number,
  currentStageChecklist: ChecklistItemViewModel[],
  /** The case's organization, so retired items are excluded from the
      stages the case is not currently sitting in. The current stage needs
      no such adjustment — `currentStageChecklist` has already had them
      removed by `resolveChecklist`. Optional so existing callers that only
      have a snapshot keep their previous totals. */
  organizationId?: string,
): CaseProgress {
  let completedItems = 0;
  let totalItems = 0;

  for (const stage of displayStagesInOrder(snapshot)) {
    const stageItemCount = activeChecklistItemCount(organizationId, stage.displayStage, stage.checklist.items);
    if (stage.displayStage < currentDisplayStage) {
      totalItems += stageItemCount;
      completedItems += stageItemCount;
    } else if (stage.displayStage === currentDisplayStage) {
      totalItems += currentStageChecklist.length;
      completedItems += currentStageChecklist.filter((item) => item.done).length;
    } else {
      totalItems += stageItemCount;
    }
  }

  // totalItems === 0 is only reachable with a degenerate, items-free
  // template no real fixture builds today — treated as "nothing to
  // complete," not a divide-by-zero NaN.
  const percent = totalItems === 0 ? 100 : Math.round((completedItems / totalItems) * 100);

  return {
    completedItems,
    totalItems,
    // completedItems <= totalItems always holds by construction above, so
    // this is already within [0, 100] — the clamp is a defensive bound
    // against ever regressing that, not a case this can currently reach.
    percent: Math.min(100, Math.max(0, percent)),
  };
}
