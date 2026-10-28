import type { Case } from '@/types/case';
import { DOCUMENT_TYPES } from './documentTypeRegistry';
import { checklistItemsForEvent } from '@/domain/sla/slaMilestones';
import { checklistItemKey } from '@/domain/workflow/checklistItemKey';
import { applyMedicalExaminerVariant } from '@/domain/organization/medicalExaminerWorkflow';
import { retiredChecklistIndices } from '@/domain/organization/checklistRetirement';
import { presentedChecklistLabel } from '@/domain/organization/checklistRelabel';

/**
 * ME Form / Crematory Form (2026-10). Two single pages copied, unchanged,
 * out of the case's completed Arrangement Forms PDF. Manors' packet (both
 * the Jotform PDF and the paper packet) has:
 *
 *   page 2  Release Authorization for Removal of Decedent → "Release Form"
 *           (named "ME Form" until 2026-10; the document type key is unchanged),
 *           for cases involving the Medical Examiner;
 *   page 3  Authorization for Cremation and Disposition   → "Crematory Form",
 *           sent to the crematory once the permit is available.
 *
 * Pure — the service (services/arrangementPageExtractService.ts) does the
 * copying and storing. Nothing here is ever sent anywhere.
 */
export type ArrangementExtractKind = 'me_form' | 'crematory_form';

export const ARRANGEMENT_EXTRACTS: Record<ArrangementExtractKind, { page: number; documentTypeKey: string; displayName: string; fileName: string }> = {
  me_form: {
    page: 2,
    documentTypeKey: DOCUMENT_TYPES.EXTERNAL_FORM_ME_FORM.key,
    displayName: DOCUMENT_TYPES.EXTERNAL_FORM_ME_FORM.displayName,
    fileName: 'Release Form.pdf',
  },
  crematory_form: {
    page: 3,
    documentTypeKey: DOCUMENT_TYPES.EXTERNAL_FORM_CREMATORY_FORM.key,
    displayName: DOCUMENT_TYPES.EXTERNAL_FORM_CREMATORY_FORM.displayName,
    fileName: 'Crematory Form.pdf',
  },
};

export const ARRANGEMENT_FORMS_DOCUMENT_TYPE_KEY = DOCUMENT_TYPES.EXTERNAL_FORM_ARRANGEMENT_FORMS.key;

export function isArrangementExtractKind(value: unknown): value is ArrangementExtractKind {
  return value === 'me_form' || value === 'crematory_form';
}

/**
 * Whether the case's own data shows the cremation permit is available:
 * a recorded state approval, a recorded "permit sent to crematory", the
 * "Permit sent to crematory" checklist item ticked, or (2026-10) the last
 * step of workflow 2 checked — the moment the Crematory Form is prepared. Nothing else is taken
 * as the permit — not the case's stage, not any later event. When none of
 * these is recorded, staff must confirm they verified it themselves.
 */
export type CrematoryPermitStatus = { confirmed: true; basis: string } | { confirmed: false; basis: null };

type WorkflowCase = Pick<Case, 'organizationId' | 'isMedicalExaminerCase' | 'workflowSnapshot' | 'checklistState'>;

/** A stage's checklist exactly as the case shows it: the Medical Examiner
    variant applied, retired items left out — the same rules the case
    page's checklist uses (domain/workflow/resolveChecklist.ts). */
function visibleItems(case_: WorkflowCase, displayStage: number) {
  const stage = case_.workflowSnapshot?.stages.find((candidate) => candidate.displayStage === displayStage);
  if (!stage) return [];
  const presented = applyMedicalExaminerVariant(stage.checklist.items, case_.organizationId, displayStage, case_.isMedicalExaminerCase === true);
  const retired = retiredChecklistIndices(case_.organizationId, displayStage, presented);
  return presented.filter((item) => !retired.has(item.index));
}

/**
 * The workflow moment the Crematory Form is prepared (2026-10): the LAST
 * step of workflow 2 (EDRS & Doctor / Cause of Death — "Hardsave for state
 * approval…", or the last ME verification step on an ME case) is checked,
 * and the FIRST step of workflow 3 ("Permit sent to crematory") is still
 * pending. Null when the case's workflow does not have both stages.
 */
export function crematoryFormWorkflowState(case_: WorkflowCase): { ready: boolean; lastStepLabel: string; nextStepLabel: string } | null {
  const stage2 = visibleItems(case_, 2);
  const stage3 = visibleItems(case_, 3);
  if (stage2.length === 0 || stage3.length === 0) return null;
  const last = stage2[stage2.length - 1];
  const first = stage3[0];
  const checked = (displayStage: number, index: number) => case_.checklistState?.[checklistItemKey(displayStage, index)] === true;
  return {
    ready: checked(2, last.index) && !checked(3, first.index),
    lastStepLabel: presentedChecklistLabel(case_.organizationId, 2, last),
    nextStepLabel: presentedChecklistLabel(case_.organizationId, 3, first),
  };
}

/** Whether a case save just reached that moment (it was not there before).
    `before` is null for a new case. */
export function crematoryFormIsDue(before: WorkflowCase | null, after: WorkflowCase & Pick<Case, 'isDeleted'>): boolean {
  if (after.isDeleted) return false;
  if (crematoryFormWorkflowState(after)?.ready !== true) return false;
  return before === null || crematoryFormWorkflowState(before)?.ready !== true;
}

export function crematoryPermitStatus(case_: Pick<Case, 'slaEvents' | 'checklistState' | 'workflowSnapshot'> & Partial<WorkflowCase>): CrematoryPermitStatus {
  if (case_.slaEvents?.approval_received?.at) return { confirmed: true, basis: 'State approval recorded' };
  if (case_.slaEvents?.permit_sent?.at) return { confirmed: true, basis: 'Permit sent to crematory recorded' };
  const items = checklistItemsForEvent(case_, 'permit_sent');
  if (items.length > 0 && items.every((item) => case_.checklistState?.[checklistItemKey(item.displayStage, item.index)] === true)) {
    return { confirmed: true, basis: '"Permit sent to crematory" checked' };
  }
  // The workflow moment above: the last step of workflow 2 is checked.
  if (case_.organizationId) {
    const stage2 = visibleItems(case_ as WorkflowCase, 2);
    const last = stage2[stage2.length - 1];
    if (last && case_.checklistState?.[checklistItemKey(2, last.index)] === true) {
      return { confirmed: true, basis: `"${presentedChecklistLabel(case_.organizationId, 2, last)}" checked` };
    }
  }
  return { confirmed: false, basis: null };
}
