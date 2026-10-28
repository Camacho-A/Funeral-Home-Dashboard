import type { Case } from '@/types/case';
import { DOCUMENT_TYPES } from './documentTypeRegistry';
import { checklistItemsForEvent } from '@/domain/sla/slaMilestones';
import { checklistItemKey } from '@/domain/workflow/checklistItemKey';

/**
 * ME Form / Crematory Form (2026-10). Two single pages copied, unchanged,
 * out of the case's completed Arrangement Forms PDF. Manors' packet (both
 * the Jotform PDF and the paper packet) has:
 *
 *   page 2  Release Authorization for Removal of Decedent → "ME Form",
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
    fileName: 'ME Form.pdf',
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
 * a recorded state approval, a recorded "permit sent to crematory", or the
 * "Permit sent to crematory" checklist item ticked. Nothing else is taken
 * as the permit — not the case's stage, not any later event. When none of
 * these is recorded, staff must confirm they verified it themselves.
 */
export type CrematoryPermitStatus = { confirmed: true; basis: string } | { confirmed: false; basis: null };

export function crematoryPermitStatus(case_: Pick<Case, 'slaEvents' | 'checklistState' | 'workflowSnapshot'>): CrematoryPermitStatus {
  if (case_.slaEvents?.approval_received?.at) return { confirmed: true, basis: 'State approval recorded' };
  if (case_.slaEvents?.permit_sent?.at) return { confirmed: true, basis: 'Permit sent to crematory recorded' };
  const items = checklistItemsForEvent(case_, 'permit_sent');
  if (items.length > 0 && items.every((item) => case_.checklistState?.[checklistItemKey(item.displayStage, item.index)] === true)) {
    return { confirmed: true, basis: '"Permit sent to crematory" checked' };
  }
  return { confirmed: false, basis: null };
}
