import type { CaseWorkflowSnapshot } from '../../types/workflowTemplate';
import { PAYMENT_CONFIRMATION_LABEL } from './checklist';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Finds the "Payment
 * collected" checklist item's index within a case's own workflowSnapshot
 * (never a hardcoded index — a template can place it anywhere, and a
 * future organization's template might not have this exact item at all).
 * Used only to mark that item done once a Clover payment is verified
 * successful; returns null if the case's snapshot has no item with this
 * exact label, in which case the caller simply skips the checklist update
 * — "mark the checklist item complete, if appropriate" (Phase 19B's own
 * wording) allows for a template that doesn't have one at all.
 */
export function findPaymentConfirmationChecklistIndex(snapshot: CaseWorkflowSnapshot | null): number | null {
  if (!snapshot) return null;

  for (const stage of snapshot.stages) {
    const item = stage.checklist.items.find((candidate) => candidate.label === PAYMENT_CONFIRMATION_LABEL);
    if (item) return item.index;
  }

  return null;
}
