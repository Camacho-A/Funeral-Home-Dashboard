import type { DataAdapterMode } from '../lib/env';
import { getAccountByNumber } from './chartOfAccountsService';
import { getAccountBalance } from './generalLedgerService';
import { listBillsForOrganization } from './accountsPayableService';
import { listPurchaseOrdersForOrganization } from './purchaseOrderService';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import { bucketForAging, type ArAgingBucket } from '../domain/ledger/agingBuckets';

/**
 * Phase 36 (Procurement & Accounts Payable). Read-only metric resolvers over
 * the canonical services — AP figures derive strictly from the Phase 31
 * ledger (Accounts Payable 2000, Inventory Clearing 2100); procurement
 * figures from the purchase-order commitment records. Never a parallel
 * calculation. See docs/adr/ADR-040-procurement-and-accounts-payable.md.
 */
async function ledgerAccountBalance(organizationId: string, accountNumber: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  const account = await getAccountByNumber(organizationId, accountNumber, dataAdapterMode);
  if (!account) return 0;
  return getAccountBalance(organizationId, account.id, dataAdapterMode);
}

/** Accounts Payable (2000). Liability is credit-normal → negate to positive
    amount owed to suppliers. */
export async function accountsPayableBalance(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  return -(await ledgerAccountBalance(organizationId, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_PAYABLE, dataAdapterMode)) || 0;
}

/** Inventory Clearing / GRNI (2100). Received-but-unbilled value; credit-
    normal → negate to positive. */
export async function goodsReceivedNotInvoiced(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  return -(await ledgerAccountBalance(organizationId, STARTER_ACCOUNT_NUMBERS.INVENTORY_CLEARING, dataAdapterMode)) || 0;
}

/** Sum of outstanding (total − paid) across open/partially-paid bills whose
    due date is before `asOfDate` (default today). */
export async function accountsPayableOverdue(organizationId: string, dataAdapterMode: DataAdapterMode, asOfDate?: string): Promise<number> {
  const asOf = asOfDate ?? new Date().toISOString();
  const bills = await listBillsForOrganization(organizationId, dataAdapterMode);
  const asOfMs = new Date(asOf).getTime();
  return bills
    .filter((b) => (b.status === 'open' || b.status === 'partially_paid') && new Date(b.dueDate).getTime() < asOfMs)
    .reduce((sum, b) => sum + (b.totalAmountCents - b.amountPaidCents), 0);
}

/** Committed value of purchase orders not yet closed/cancelled. */
export async function openPurchaseOrderValue(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  const orders = await listPurchaseOrdersForOrganization(organizationId, dataAdapterMode);
  return orders
    .filter((p) => p.status === 'draft' || p.status === 'submitted' || p.status === 'partially_received' || p.status === 'received')
    .reduce((sum, p) => sum + p.subtotalCents, 0);
}

/** AP aging: outstanding balance bucketed by each open bill's due date,
    reusing the Phase 31 aging buckets. Positive = still owed. */
export async function accountsPayableAging(organizationId: string, dataAdapterMode: DataAdapterMode, asOfDate?: string): Promise<Record<ArAgingBucket, number>> {
  const asOf = asOfDate ?? new Date().toISOString();
  const bills = await listBillsForOrganization(organizationId, dataAdapterMode);
  const buckets: Record<ArAgingBucket, number> = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const b of bills) {
    if (b.status !== 'open' && b.status !== 'partially_paid') continue;
    const outstanding = b.totalAmountCents - b.amountPaidCents;
    if (outstanding <= 0) continue;
    buckets[bucketForAging(b.dueDate, asOf)] += outstanding;
  }
  return buckets;
}
