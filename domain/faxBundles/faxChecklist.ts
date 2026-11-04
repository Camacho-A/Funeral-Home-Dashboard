import type { Case } from '@/types/case';
import type { ChecklistItemLocation } from '../workflow/checklistAutomation';

/**
 * Manatee County DC application fax bundles (2026-11) — Manors' "DC
 * Application Sent" stage (display stage 4):
 *   item 0 "DC application filled out"     — completed when a valid
 *                                             application is saved;
 *   item 1 "Sent day before ashes arrive"  — completed only when the fax is
 *                                             CONFIRMED delivered.
 * Found by position AND exact label in the case's own frozen workflow, so a
 * case created under a template without these items is never touched.
 */
const DC_APPLICATION_STAGE = 4;
const FILLED_OUT = { index: 0, label: 'DC application filled out' };
const SENT = { index: 1, label: 'Sent day before ashes arrive' };

function locate(case_: Pick<Case, 'workflowSnapshot'>, item: { index: number; label: string }): ChecklistItemLocation[] {
  const stage = case_.workflowSnapshot?.stages.find((s) => s.displayStage === DC_APPLICATION_STAGE);
  const found = stage?.checklist.items.some((i) => i.index === item.index && i.label === item.label);
  return found ? [{ displayStage: DC_APPLICATION_STAGE, index: item.index }] : [];
}

export const dcApplicationFilledOutItem = (case_: Pick<Case, 'workflowSnapshot'>) => locate(case_, FILLED_OUT);
export const dcApplicationSentItem = (case_: Pick<Case, 'workflowSnapshot'>) => locate(case_, SENT);

export const MANATEE_APPLICATION_SAVED_EVENT = 'manatee.application_saved';
export const DC_APPLICATION_FAX_DELIVERED_EVENT = 'fax.dc_application_delivered';
