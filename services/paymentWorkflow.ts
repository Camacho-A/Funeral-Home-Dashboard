import type { DataAdapterMode } from '../lib/env';
import { buildCaseFieldPatch } from '../lib/wixCaseMapper';
import { caseFixtures } from './__mocks__/fixtures';
import { updateCaseWithRetry, writeMockCase } from './caseWriteService';
import type { Case, CaseUpdate } from '../types/case';
import { findPaymentConfirmationChecklistIndex } from '../domain/cases/paymentChecklist';
import { checklistItemKey } from '../domain/workflow/checklistItemKey';
import { getActiveCaseOrder, refreshBalanceForCase } from './pricingService';
import { postPaymentTransaction } from './financialTransactionService';
import { reconcileCaseWorkflow } from './workflowReconciliationService';
import type { ActivityContext } from './activityService';
import { automaticChecklistCompletion, isChecklistAutomationEnabled } from '../domain/workflow/checklistAutomation';
import { recordAutomaticCompletion } from './automaticChecklistCompletion';

/**
 * Phase 19B (Clover Hosted Checkout Integration). The one place a
 * verified-successful payment's effect on its Case is applied — called
 * from both the webhook route (the authoritative path) and the status-
 * polling GET route's best-effort reconciliation fallback, so the two
 * paths can never disagree about what "verified paid" means for a case.
 *
 * Per Phase 19B's own instruction: marks Case.paymentStatus paid and the
 * "Payment collected" checklist item (if the case's own workflowSnapshot
 * has one — see domain/cases/paymentChecklist.ts) done.
 *
 * Manors workflow reconciliation (2026-09) correction: this used to never
 * touch `rawStage` at all — the workflow stage only ever advanced via the
 * separate manual "Advance to next stage" action. That meant a case whose
 * every other prerequisite was already genuinely complete (e.g. its
 * Arrangement Form already linked) stayed stuck at its current stage
 * after payment, requiring a manual advance even though nothing was
 * actually left to do. Once the balance genuinely reaches 0 below, this
 * now also calls `workflowReconciliationService#reconcileCaseWorkflow` —
 * which independently recomputes the correct stage from every
 * prerequisite, never blindly advances, and never regresses a
 * further-along case. `domain/cases/transitions.ts#advanceToNextStage`
 * remains the separate, unconditional manual action.
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
 *
 * Phase 31 (Financial Management & General Ledger) correction: `financialPosting`
 * is optional and additive — every real caller (the webhook route, both
 * mock-mode simulate routes, and the staff status-poll route's wix-mode
 * reconciliation fallback) only ever invokes this function once per
 * genuine pending→succeeded `PaymentRecord` transition (each already
 * gates on `status !== 'pending'`/"status actually changed" before
 * calling), so passing it here can never double-post the same payment's
 * journal entry across retried/duplicate webhook deliveries. When
 * provided, posts the Dr Undeposited Funds / Cr Accounts Receivable entry
 * (`services/financialTransactionService.ts#postPaymentTransaction`)
 * before the existing balance-refresh logic below — the accounting
 * record for a payment is unconditional, independent of whether this
 * particular payment happens to bring the case's own balance to zero.
 */
export async function markCasePaidIfVerified(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
  financialPosting?: {
    paymentId: string;
    amountCents: number;
    ctx: ActivityContext;
    idFactory: () => string;
  },
): Promise<void> {
  if (financialPosting) {
    await postPaymentTransaction(
      organizationId,
      {
        caseId,
        paymentId: financialPosting.paymentId,
        amountCents: financialPosting.amountCents,
        idFactory: financialPosting.idFactory,
      },
      financialPosting.ctx,
      dataAdapterMode,
    );
  }

  const activeOrder = await getActiveCaseOrder(organizationId, caseId, dataAdapterMode);
  if (activeOrder) {
    const refreshed = await refreshBalanceForCase(organizationId, caseId, dataAdapterMode);
    if ((refreshed?.balanceDue ?? 0) > 0) return; // still owes a balance — not fully paid yet
  }

  // Case concurrency (2026-10). Only `paymentStatus` and the ONE payment
  // checklist key are set — merged onto the case as it is at write time,
  // conditioned on its revision, recomputed on conflict (bounded; see
  // services/caseWriteService.ts). It used to full-replace the row from its
  // own read, so a staff edit landing in between was undone, and a stale
  // staff checklist save could later erase the payment tick. An archived
  // case is still left alone, exactly as before.
  // Automatic checklist completion (2026-10, Manors): the tick goes through
  // the shared decision (never over a staff correction, never twice) and
  // carries its provenance; an applied tick is recorded once in activity.
  // Every other organization keeps the behaviour below exactly.
  const automationEnabled = isChecklistAutomationEnabled(organizationId);
  const paymentTrigger = { source: 'payment_confirmed' as const, eventType: 'payment.paid_in_full', eventId: financialPosting?.paymentId ?? null };
  const now = new Date().toISOString();
  let autoCompleted: { case_: Case; location: { displayStage: number; index: number } } | null = null;

  const paidPatch = (case_: Case): CaseUpdate | null => {
    autoCompleted = null;
    if (case_.isDeleted) return null;
    const paymentChecklistItem = findPaymentConfirmationChecklistIndex(case_.workflowSnapshot);
    if (automationEnabled) {
      const completion = paymentChecklistItem ? automaticChecklistCompletion(case_, paymentChecklistItem, paymentTrigger, now) : null;
      if (completion && paymentChecklistItem) autoCompleted = { case_, location: paymentChecklistItem };
      return { paymentStatus: 'paid_in_full', ...(completion ?? {}) };
    }
    return {
      paymentStatus: 'paid_in_full',
      ...(paymentChecklistItem === null
        ? {}
        : { checklistState: { [checklistItemKey(paymentChecklistItem.displayStage, paymentChecklistItem.index)]: true } }),
    };
  };

  const recordIfCompleted = async () => {
    const done = autoCompleted as { case_: Case; location: { displayStage: number; index: number } } | null;
    if (done) await recordAutomaticCompletion(done.case_, done.location, paymentTrigger, dataAdapterMode, financialPosting?.ctx.correlationId);
  };

  if (dataAdapterMode === 'mock') {
    const case_ = caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId);
    const patch = case_ ? paidPatch(case_) : null;
    if (!case_ || !patch) return;
    writeMockCase(organizationId, caseId, (current) => ({
      ...current,
      ...patch,
      checklistState: { ...current.checklistState, ...(patch.checklistState ?? {}) },
      ...(patch.checklistCompletions ? { checklistCompletions: { ...current.checklistCompletions, ...patch.checklistCompletions } } : {}),
    }));
    await recordIfCompleted();
    await reconcileCaseWorkflow(organizationId, caseId, dataAdapterMode);
    return;
  }

  const outcome = await updateCaseWithRetry(organizationId, caseId, (row) => {
    const patch = paidPatch(row.case_);
    return patch ? buildCaseFieldPatch(row.data, patch) : null;
  });
  if (outcome.result === 'not_found') return;
  if (outcome.result === 'conflict') {
    // A webhook/poll redelivery converges idempotently (the decision is
    // re-made from the case as it then is).
    throw new Error(`Marking case ${caseId} paid lost to concurrent writes on every attempt.`);
  }
  if (outcome.result === 'failed') throw new Error(`Marking case ${caseId} paid failed: ${outcome.reason}`);
  // Only a write that actually landed completed anything.
  if (outcome.result === 'applied') await recordIfCompleted();
  await reconcileCaseWorkflow(organizationId, caseId, dataAdapterMode);
}
