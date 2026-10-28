import type { Case } from '../../types/case';

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
