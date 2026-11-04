import type { DataAdapterMode } from '../lib/env';
import { computeCaseBalance, type CaseBalance } from '../domain/billing/caseBalance';
import { listPaymentRecordsForCase } from './paymentsService';
import { getCaseOrderState, getWriteOffTotalForCase } from './pricingService';

/**
 * Case balance and overpayment (2026-11) — the server's read of
 * domain/billing/caseBalance.ts for one case of one organization: the
 * order the case is billed for (the effective version, also while a change
 * is interrupted), its succeeded payments and its write-offs. Null when the
 * case has no order. Reads only.
 */
export async function getCaseBalance(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<CaseBalance | null> {
  const [{ effective: order }, payments, writeOffCents] = await Promise.all([
    getCaseOrderState(organizationId, caseId, dataAdapterMode),
    listPaymentRecordsForCase(organizationId, caseId, dataAdapterMode),
    getWriteOffTotalForCase(organizationId, caseId, dataAdapterMode),
  ]);
  if (!order) return null;
  return computeCaseBalance({
    orderTotalCents: order.total,
    payments: payments.filter((p) => p.organizationId === organizationId && p.caseId === caseId),
    writeOffCents,
  });
}
