import type { CaseWorkflowSnapshot } from '../../types/workflowTemplate';
import { PAYMENT_CONFIRMATION_LABEL } from './checklist';

export type PaymentConfirmationChecklistLocation = { displayStage: number; index: number };

/**
 * Phase 19B (Clover Hosted Checkout Integration). Finds the "Payment
 * collected" checklist item's displayStage+index within a case's own
 * workflowSnapshot (never a hardcoded index — a template can place it
 * anywhere, and a future organization's template might not have this
 * exact item at all). Used only to mark that item done once a Clover
 * payment is verified successful; returns null if the case's snapshot has
 * no item with this exact label, in which case the caller simply skips
 * the checklist update — "mark the checklist item complete, if
 * appropriate" (Phase 19B's own wording) allows for a template that
 * doesn't have one at all.
 *
 * Returns the stage's `displayStage` alongside the item's local `index` —
 * B2026-035 (2026-10): writing the bare index alone, with no stage
 * information, is exactly the ambiguity that caused a different stage's
 * unrelated item at the same local index to read as done. The caller must
 * build its checklistState patch via
 * domain/workflow/checklistItemKey.ts#writeChecklistValue with both
 * values, never a bare `{ [index]: true }`.
 */
export function findPaymentConfirmationChecklistIndex(
  snapshot: CaseWorkflowSnapshot | null,
): PaymentConfirmationChecklistLocation | null {
  if (!snapshot) return null;

  for (const stage of snapshot.stages) {
    const item = stage.checklist.items.find((candidate) => candidate.label === PAYMENT_CONFIRMATION_LABEL);
    if (item) return { displayStage: stage.displayStage, index: item.index };
  }

  return null;
}
