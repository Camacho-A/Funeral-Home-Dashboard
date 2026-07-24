import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, updateWixDataItem } from '../lib/wixDataApi';
import { mapWixCaseItem, applyCaseUpdateToWixData, type WixCaseItem } from '../lib/wixCaseMapper';
import { caseFixtures } from './__mocks__/fixtures';
import { findPaymentConfirmationChecklistIndex } from '../domain/cases/paymentChecklist';

/**
 * Phase 19B (Clover Hosted Checkout Integration). The one place a
 * verified-successful payment's effect on its Case is applied — called
 * from both the webhook route (the authoritative path) and the status-
 * polling GET route's best-effort reconciliation fallback, so the two
 * paths can never disagree about what "verified paid" means for a case.
 *
 * Per Phase 19B's own instruction: marks Case.paymentStatus paid and the
 * "Payment collected" checklist item (if the case's own workflowSnapshot
 * has one — see domain/cases/paymentChecklist.ts) done. Never touches
 * `rawStage` — the workflow stage is never auto-advanced by a payment
 * event, only by whatever explicit stage-transition action already
 * exists (see domain/cases/transitions.ts).
 *
 * Idempotent by construction: setting paymentStatus to 'paid_in_full' and
 * checklistState[index] to true again for an already-paid case is a
 * harmless no-op, which is exactly what's needed for duplicate/out-of-
 * order webhook delivery (this function may run more than once for the
 * same case).
 */
export async function markCasePaidIfVerified(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const index = caseFixtures.findIndex((c) => c.id === caseId && c.organizationId === organizationId);
    if (index === -1) return;
    const case_ = caseFixtures[index];
    const checklistIndex = findPaymentConfirmationChecklistIndex(case_.workflowSnapshot);
    caseFixtures[index] = {
      ...case_,
      paymentStatus: 'paid_in_full',
      checklistState:
        checklistIndex === null ? case_.checklistState : { ...case_.checklistState, [checklistIndex]: true },
    };
    return;
  }

  const response = await queryWixDataItems<WixCaseItem>('cases', {
    filter: { beaconCaseId: caseId, organizationId, isArchived: false },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return;

  const case_ = mapWixCaseItem(existingItem.data);
  if (!case_) return;

  const checklistIndex = findPaymentConfirmationChecklistIndex(case_.workflowSnapshot);
  const mergedData = applyCaseUpdateToWixData(existingItem.data, {
    paymentStatus: 'paid_in_full',
    checklistState: checklistIndex === null ? undefined : { ...case_.checklistState, [checklistIndex]: true },
  });

  await updateWixDataItem<WixCaseItem>('cases', existingItem.id, mergedData);
}
