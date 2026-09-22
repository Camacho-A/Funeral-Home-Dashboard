import type { Case } from '../../types/case';

/**
 * "Completed" is only shown once the remains-return requirement is
 * actually satisfied — ported from design/support.js's buildCase(), which
 * falls back to the prior stage's label otherwise.
 *
 * Conditional shipping/tracking (2026-09): this used to read
 * `checklist[0]?.done` — an independent, manually-toggled checkbox
 * ("Family picked up ashes") with zero connection to the structured
 * `pickupStatus` field. That created exactly the "two competing completion
 * mechanisms" risk this phase was asked to eliminate: staff could check the
 * box without ever recording a release, or vice versa, and neither
 * Shipping nor Undecided had any sensible checkbox text at all. The
 * completion signal now comes from `remainsReturnRequirementComplete`
 * (computed by the caller via
 * `domain/cases/returnMethod.ts#isTerminalReturnRequirementComplete`,
 * derived from `returnMethod` + `pickupStatus`/`shippingDeliveryStatus`) —
 * the checklist item itself is now a read-only reflection of this same
 * value, never an independent input (see domain/cases/viewModel.ts).
 *
 * Phase 11: `lastDisplayStage` is a parameter (from the case's own
 * workflowSnapshot, via domain/workflow/resolveStages.ts's
 * lastDisplayStage) instead of the hardcoded LAST_DISPLAY_STAGE constant —
 * this rule is applied uniformly to every template's own final stage, not
 * assumed to be Managed Cremations' specific 7-stage list. `stageLabelFor`
 * (which used to live here too) moved to domain/workflow/resolveStages.ts's
 * findStageByDisplayStage, since label lookup is now snapshot-driven.
 */
export function resolveEffectiveDisplayStage(
  displayStage: number,
  lastDisplayStage: number,
  remainsReturnRequirementComplete: boolean,
): number {
  const isLastStage = displayStage === lastDisplayStage;
  return isLastStage && !remainsReturnRequirementComplete ? displayStage - 1 : displayStage;
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
