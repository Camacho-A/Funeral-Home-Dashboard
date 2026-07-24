import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, updateWixDataItem } from '../lib/wixDataApi';
import { mapWixCaseItem, applyCaseUpdateToWixData, type WixCaseItem } from '../lib/wixCaseMapper';
import { caseFixtures } from './__mocks__/fixtures';
import { findPaymentConfirmationChecklistIndex } from '../domain/cases/paymentChecklist';
import { getActiveCaseOrder, refreshBalanceForCase } from './pricingService';

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
 *
 * Phase 19C (Service Catalog, Case Order & Pricing Engine) correction: a
 * case with an itemized CaseOrder supports multiple payments against one
 * balance (a deposit followed by a final payment, for instance) — a
 * single verified success no longer automatically means "fully paid" for
 * such a case. This function now refreshes the CaseOrder's own balanceDue
 * (services/pricingService.ts's refreshBalanceForCase) first, and only
 * marks the Case paymentStatus 'paid_in_full' once that balance has
 * actually reached 0. A case with no CaseOrder at all (pre-Phase-19C data)
 * keeps the original unconditional behavior — one verified payment means
 * paid, exactly as Phase 19B specified for a case with a single freeform
 * amount.
 */
export async function markCasePaidIfVerified(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  const activeOrder = await getActiveCaseOrder(organizationId, caseId, dataAdapterMode);
  if (activeOrder) {
    const refreshed = await refreshBalanceForCase(organizationId, caseId, dataAdapterMode);
    if ((refreshed?.balanceDue ?? 0) > 0) return; // still owes a balance — not fully paid yet
  }

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
