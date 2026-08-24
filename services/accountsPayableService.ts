import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import { mapWixVendorBillItem, buildWixVendorBillData, applyVendorBillUpdateToWixData, type WixVendorBillItem } from '../lib/wixVendorBillMapper';
import { mapWixVendorBillLineItemItem, buildWixVendorBillLineItemData, type WixVendorBillLineItemItem } from '../lib/wixVendorBillLineItemMapper';
import { mapWixBillPaymentItem, buildWixBillPaymentData, type WixBillPaymentItem } from '../lib/wixBillPaymentMapper';
import type { VendorBill, VendorBillStatus } from '../types/vendorBill';
import type { VendorBillLineItem } from '../types/vendorBillLineItem';
import type { BillPayment, BillPaymentMethod } from '../types/billPayment';
import { buildVendorBillPosting, buildBillPaymentPosting, VendorBillPostingError } from '../domain/ledger/vendorBillPosting';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import { createAndPostJournalEntry, reverseJournalEntry, listJournalEntriesForOrganization } from './generalLedgerService';
import { getAccountByNumber, backfillMissingStarterAccounts } from './chartOfAccountsService';
import { getSupplierById } from './supplierService';
import { getMovementById } from './inventoryService';
import { applyBilledDelta } from './purchaseOrderService';
import { withAggregateLease, commitLeasedWrite, vendorBillLeaseKey } from './aggregateLeaseService';
import { recordVendorBillCreated, recordVendorBillVoided, recordBillPaymentRecorded, type ActivityContext } from './activityService';
import { vendorBillFixtures, vendorBillLineItemFixtures, billPaymentFixtures } from './__mocks__/procurementFixtures';

/**
 * Phase 36 (Procurement & Accounts Payable). Sole writer of `vendorBills`,
 * `vendorBillLineItems`, and `billPayments`. Posts `bill` and `bill_payment`
 * journal entries through the authoritative Phase 31 ledger — following
 * pricingService's "peer consumer of the ledger" pattern (calls
 * createAndPostJournalEntry / getAccountByNumber directly) to avoid an import
 * cycle. Posted entries are immutable: a bill is corrected by VOID (which
 * reverses its entry, never edits/deletes it). Idempotency is enforced with a
 * deterministic sourceReferenceId + read-existing-and-skip. Posting-sensitive
 * transitions run under a narrow per-bill lease. AP NEVER mutates inventory
 * quantities and NEVER uses the customer-facing PaymentService/PaymentRecord.
 * See docs/adr/ADR-040-procurement-and-accounts-payable.md.
 */
export class AccountsPayableServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'invalid_input' | 'invalid_state' | 'duplicate_bill' | 'over_bill' | 'over_pay' | 'invalid_account',
  ) {
    super(message);
    this.name = 'AccountsPayableServiceError';
  }
}

// --- Reads ------------------------------------------------------------------

export async function listBillsForOrganization(organizationId: string, dataAdapterMode: DataAdapterMode, options: { status?: VendorBillStatus } = {}): Promise<VendorBill[]> {
  let bills: VendorBill[];
  if (dataAdapterMode === 'mock') {
    bills = vendorBillFixtures.filter((b) => b.organizationId === organizationId);
  } else {
    const filter: Record<string, unknown> = { organizationId };
    if (options.status) filter.status = options.status;
    const response = await queryWixDataItems<WixVendorBillItem>('vendorBills', { filter });
    bills = response.dataItems.map((i) => mapWixVendorBillItem(i.data)).filter((b): b is VendorBill => b !== null);
  }
  const filtered = options.status ? bills.filter((b) => b.status === options.status) : bills;
  return filtered.sort((a, b) => (a.billDate < b.billDate ? 1 : -1));
}

export async function getBillById(organizationId: string, vendorBillId: string, dataAdapterMode: DataAdapterMode): Promise<VendorBill | null> {
  if (dataAdapterMode === 'mock') return vendorBillFixtures.find((b) => b.organizationId === organizationId && b.id === vendorBillId) ?? null;
  const response = await queryWixDataItems<WixVendorBillItem>('vendorBills', { filter: { organizationId, beaconVendorBillId: vendorBillId }, paging: { limit: 1 } });
  return mapWixVendorBillItem(response.dataItems[0]?.data);
}

export async function listLineItemsForBill(organizationId: string, vendorBillId: string, dataAdapterMode: DataAdapterMode): Promise<VendorBillLineItem[]> {
  let lines: VendorBillLineItem[];
  if (dataAdapterMode === 'mock') {
    lines = vendorBillLineItemFixtures.filter((l) => l.organizationId === organizationId && l.vendorBillId === vendorBillId);
  } else {
    const response = await queryWixDataItems<WixVendorBillLineItemItem>('vendorBillLineItems', { filter: { organizationId, vendorBillId } });
    lines = response.dataItems.map((i) => mapWixVendorBillLineItemItem(i.data)).filter((l): l is VendorBillLineItem => l !== null);
  }
  return lines.sort((a, b) => a.lineNumber - b.lineNumber);
}

export async function listPaymentsForBill(organizationId: string, vendorBillId: string, dataAdapterMode: DataAdapterMode): Promise<BillPayment[]> {
  if (dataAdapterMode === 'mock') return billPaymentFixtures.filter((p) => p.organizationId === organizationId && p.vendorBillId === vendorBillId);
  const response = await queryWixDataItems<WixBillPaymentItem>('billPayments', { filter: { organizationId, vendorBillId } });
  return response.dataItems.map((i) => mapWixBillPaymentItem(i.data)).filter((p): p is BillPayment => p !== null);
}

/** Sum of quantity already billed against a receipt across all NON-VOID bill
    lines — the authoritative "how much of this receipt is billed". Voiding a
    bill reopens its receipts because void bills are excluded here. */
export async function billedQuantityForReceipt(organizationId: string, receiptMovementId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  const lines = await listAllBillLines(organizationId, dataAdapterMode);
  const bills = await listBillsForOrganization(organizationId, dataAdapterMode);
  const voidBillIds = new Set(bills.filter((b) => b.status === 'void').map((b) => b.id));
  return lines
    .filter((l) => l.lineKind === 'goods' && l.receiptMovementId === receiptMovementId && !voidBillIds.has(l.vendorBillId))
    .reduce((n, l) => n + (l.quantityBilled ?? 0), 0);
}

export type BillableReceipt = {
  receiptMovementId: string;
  productId: string;
  purchaseOrderLineItemId: string | null;
  receivedQuantity: number;
  billedQuantity: number;
  billableQuantity: number;
  receiptUnitCostCents: number;
};

/**
 * Three-way-match view for a PO: each authoritative receiving movement with
 * its received quantity, how much is already billed (derived from non-void
 * bill lines), and what remains billable. This is the data a bill is built
 * against — PO line, receipt, and bill-line records compared independently,
 * never collapsed to a matched/unmatched boolean.
 */
export async function listBillableReceiptsForPurchaseOrder(organizationId: string, purchaseOrderLineItemIds: readonly string[], dataAdapterMode: DataAdapterMode): Promise<BillableReceipt[]> {
  const { listMovementsByType } = await import('./inventoryService');
  const receipts = await listMovementsByType(organizationId, 'receiving', dataAdapterMode);
  const lineIdSet = new Set(purchaseOrderLineItemIds);
  const result: BillableReceipt[] = [];
  for (const r of receipts) {
    if (!r.purchaseOrderLineItemId || !lineIdSet.has(r.purchaseOrderLineItemId)) continue;
    const billed = await billedQuantityForReceipt(organizationId, r.id, dataAdapterMode);
    result.push({
      receiptMovementId: r.id,
      productId: r.productId,
      purchaseOrderLineItemId: r.purchaseOrderLineItemId,
      receivedQuantity: r.quantity,
      billedQuantity: billed,
      billableQuantity: Math.max(0, r.quantity - billed),
      receiptUnitCostCents: r.unitCost ?? 0,
    });
  }
  return result;
}

async function listAllBillLines(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<VendorBillLineItem[]> {
  if (dataAdapterMode === 'mock') return vendorBillLineItemFixtures.filter((l) => l.organizationId === organizationId);
  const response = await queryWixDataItems<WixVendorBillLineItemItem>('vendorBillLineItems', { filter: { organizationId } });
  return response.dataItems.map((i) => mapWixVendorBillLineItemItem(i.data)).filter((l): l is VendorBillLineItem => l !== null);
}

async function findBillByNumber(organizationId: string, supplierId: string, billNumber: string, dataAdapterMode: DataAdapterMode): Promise<VendorBill | null> {
  const bills = await listBillsForOrganization(organizationId, dataAdapterMode);
  return bills.find((b) => b.supplierId === supplierId && b.billNumber.trim().toLowerCase() === billNumber.trim().toLowerCase() && b.status !== 'void') ?? null;
}

// --- Ledger helpers (peer-consumer of generalLedgerService) -----------------

async function resolveAccountId(organizationId: string, accountNumber: string, idFactory: () => string, dataAdapterMode: DataAdapterMode): Promise<string> {
  let account = await getAccountByNumber(organizationId, accountNumber, dataAdapterMode);
  if (!account) {
    await backfillMissingStarterAccounts(organizationId, idFactory, dataAdapterMode);
    account = await getAccountByNumber(organizationId, accountNumber, dataAdapterMode);
  }
  if (!account) throw new AccountsPayableServiceError(`Ledger account ${accountNumber} could not be resolved.`, 'invalid_account');
  return account.id;
}

async function assertValidExpenseAccount(organizationId: string, accountNumber: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  const forbidden = [STARTER_ACCOUNT_NUMBERS.INVENTORY_ASSET, STARTER_ACCOUNT_NUMBERS.INVENTORY_CLEARING, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_PAYABLE];
  if (forbidden.includes(accountNumber as never)) {
    throw new AccountsPayableServiceError(`Expense lines cannot post to ${accountNumber} — an expense bill must never manufacture inventory or a payable.`, 'invalid_account');
  }
  const account = await getAccountByNumber(organizationId, accountNumber, dataAdapterMode);
  if (!account) throw new AccountsPayableServiceError(`Expense account ${accountNumber} does not exist.`, 'invalid_account');
  if (account.accountType !== 'expense' && account.accountType !== 'asset') {
    throw new AccountsPayableServiceError(`Expense line account ${accountNumber} must be an expense or (non-inventory) asset account.`, 'invalid_account');
  }
}

async function assertValidCashAccount(organizationId: string, accountNumber: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  const account = await getAccountByNumber(organizationId, accountNumber, dataAdapterMode);
  if (!account) throw new AccountsPayableServiceError(`Cash account ${accountNumber} does not exist.`, 'invalid_account');
  if (account.accountType !== 'asset') throw new AccountsPayableServiceError(`Payment cash account ${accountNumber} must be an asset (cash/bank) account.`, 'invalid_account');
}

// --- Create bill ------------------------------------------------------------

export type CreateVendorBillInput = {
  organizationId: string;
  supplierId: string;
  billNumber: string;
  purchaseOrderId?: string | null;
  billDate: string;
  dueDate: string;
  goodsLines: Array<{ receiptMovementId: string; quantityBilled: number; billedUnitCostCents: number }>;
  expenseLines: Array<{ accountNumber: string; amountCents: number; description?: string | null }>;
  notes?: string | null;
  createdByStaffProfileId?: string | null;
  idFactory: () => string;
  now?: string;
};

export async function createVendorBill(input: CreateVendorBillInput, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<{ bill: VendorBill; lineItems: VendorBillLineItem[] }> {
  const supplier = await getSupplierById(input.organizationId, input.supplierId, dataAdapterMode);
  if (!supplier) throw new AccountsPayableServiceError('Supplier not found.', 'invalid_input');
  // Ensure the starter chart (incl. 2000/2100/5120 and expense accounts)
  // exists before validating/posting — idempotent add-only backfill.
  await backfillMissingStarterAccounts(input.organizationId, input.idFactory, dataAdapterMode);
  if ((input.goodsLines?.length ?? 0) === 0 && (input.expenseLines?.length ?? 0) === 0) {
    throw new AccountsPayableServiceError('A bill needs at least one goods or expense line.', 'invalid_input');
  }
  const billNumber = input.billNumber.trim();
  if (billNumber.length === 0) throw new AccountsPayableServiceError('Bill number is required.', 'invalid_input');
  const dup = await findBillByNumber(input.organizationId, input.supplierId, billNumber, dataAdapterMode);
  if (dup) throw new AccountsPayableServiceError(`Bill "${billNumber}" already exists for this supplier.`, 'duplicate_bill');

  const nowIso = input.now ?? new Date().toISOString();
  const billId = input.idFactory();
  const lineItems: VendorBillLineItem[] = [];
  let lineNumber = 1;

  // Build & validate goods lines against their authoritative receipts.
  const goodsPostingInput: Array<{ grniValueCents: number; billedAmountCents: number }> = [];
  const billedDeltasByPoLine = new Map<string, number>();
  for (const g of input.goodsLines ?? []) {
    if (!Number.isInteger(g.quantityBilled) || g.quantityBilled <= 0) throw new AccountsPayableServiceError('Goods line quantity must be a positive integer.', 'invalid_input');
    if (!Number.isInteger(g.billedUnitCostCents) || g.billedUnitCostCents < 0) throw new AccountsPayableServiceError('Billed unit cost must be a non-negative integer number of cents.', 'invalid_input');
    const receipt = await getMovementById(input.organizationId, g.receiptMovementId, dataAdapterMode);
    if (!receipt || receipt.movementType !== 'receiving') throw new AccountsPayableServiceError(`Receipt ${g.receiptMovementId} not found.`, 'invalid_input');
    const receiptUnitCost = receipt.unitCost ?? 0;
    const alreadyBilled = await billedQuantityForReceipt(input.organizationId, g.receiptMovementId, dataAdapterMode);
    if (alreadyBilled + g.quantityBilled > receipt.quantity) {
      throw new AccountsPayableServiceError(`Over-bill: receipt has ${receipt.quantity} unit(s), ${alreadyBilled} already billed, cannot bill ${g.quantityBilled} more.`, 'over_bill');
    }
    const grniValueCents = g.quantityBilled * receiptUnitCost;
    const lineAmountCents = g.quantityBilled * g.billedUnitCostCents;
    goodsPostingInput.push({ grniValueCents, billedAmountCents: lineAmountCents });
    lineItems.push({
      id: input.idFactory(),
      organizationId: input.organizationId,
      vendorBillId: billId,
      lineNumber: lineNumber++,
      lineKind: 'goods',
      receiptMovementId: g.receiptMovementId,
      purchaseOrderLineItemId: receipt.purchaseOrderLineItemId,
      productId: receipt.productId,
      productDescriptionSnapshot: null,
      quantityBilled: g.quantityBilled,
      grniValueCents,
      billedUnitCostCents: g.billedUnitCostCents,
      varianceCents: lineAmountCents - grniValueCents,
      expenseAccountNumber: null,
      expenseDescription: null,
      lineAmountCents,
      createdAt: nowIso,
    });
    if (receipt.purchaseOrderLineItemId) {
      billedDeltasByPoLine.set(receipt.purchaseOrderLineItemId, (billedDeltasByPoLine.get(receipt.purchaseOrderLineItemId) ?? 0) + g.quantityBilled);
    }
  }

  // Build & validate expense lines.
  const expensePostingInput: Array<{ accountNumber: string; amountCents: number }> = [];
  for (const e of input.expenseLines ?? []) {
    if (!Number.isInteger(e.amountCents) || e.amountCents <= 0) throw new AccountsPayableServiceError('Expense line amount must be a positive integer number of cents.', 'invalid_input');
    await assertValidExpenseAccount(input.organizationId, e.accountNumber, dataAdapterMode);
    expensePostingInput.push({ accountNumber: e.accountNumber, amountCents: e.amountCents });
    lineItems.push({
      id: input.idFactory(),
      organizationId: input.organizationId,
      vendorBillId: billId,
      lineNumber: lineNumber++,
      lineKind: 'expense',
      receiptMovementId: null,
      purchaseOrderLineItemId: null,
      productId: null,
      productDescriptionSnapshot: null,
      quantityBilled: null,
      grniValueCents: null,
      billedUnitCostCents: null,
      varianceCents: null,
      expenseAccountNumber: e.accountNumber,
      expenseDescription: e.description ?? null,
      lineAmountCents: e.amountCents,
      createdAt: nowIso,
    });
  }

  // Compute the balanced posting (pure, proven).
  let posting;
  try {
    posting = buildVendorBillPosting(goodsPostingInput, expensePostingInput);
  } catch (err) {
    if (err instanceof VendorBillPostingError) throw new AccountsPayableServiceError(err.message, 'invalid_input');
    throw err;
  }

  const goodsAmountCents = goodsPostingInput.reduce((n, g) => n + g.billedAmountCents, 0);
  const additionalChargesCents = posting.totalExpenseCents;
  const bill: VendorBill = {
    id: billId,
    organizationId: input.organizationId,
    billNumber,
    supplierId: input.supplierId,
    purchaseOrderId: input.purchaseOrderId ?? null,
    billDate: input.billDate,
    dueDate: input.dueDate,
    status: 'open',
    goodsAmountCents,
    additionalChargesCents,
    totalAmountCents: posting.accountsPayableCreditCents,
    amountPaidCents: 0,
    netVarianceCents: posting.netVarianceCents,
    journalEntryId: null,
    notes: input.notes ?? null,
    createdByStaffProfileId: input.createdByStaffProfileId ?? null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return withAggregateLease(vendorBillLeaseKey(input.organizationId, billId), dataAdapterMode, (handle) =>
    commitLeasedWrite(handle, dataAdapterMode, async () => {
      // Post the balanced `bill` entry (idempotent on the deterministic ref).
      const sourceReferenceId = `ap-bill-${billId}`;
      let journalEntryId: string | null = null;
      if (!(await alreadyPosted(input.organizationId, 'bill', sourceReferenceId, dataAdapterMode))) {
        const lines = [] as Array<{ accountId: string; direction: 'debit' | 'credit'; amount: number }>;
        for (const l of posting.lines) {
          lines.push({ accountId: await resolveAccountId(input.organizationId, l.accountNumber, input.idFactory, dataAdapterMode), direction: l.direction, amount: l.amount });
        }
        const { entry } = await createAndPostJournalEntry(
          input.organizationId,
          { entryDate: input.billDate, sourceType: 'bill', sourceReferenceId, memo: `Vendor bill ${billNumber} (${supplier.name})`, lines, postedByStaffProfileId: input.createdByStaffProfileId ?? null, idFactory: input.idFactory, now: nowIso },
          dataAdapterMode,
        );
        journalEntryId = entry.id;
      }
      bill.journalEntryId = journalEntryId;

      // Persist bill + first-class lines.
      if (dataAdapterMode === 'mock') {
        vendorBillFixtures.push(bill);
        vendorBillLineItemFixtures.push(...lineItems);
      } else {
        await insertWixDataItem('vendorBills', buildWixVendorBillData(bill), bill.id);
        for (const l of lineItems) await insertWixDataItem('vendorBillLineItems', buildWixVendorBillLineItemData(l), l.id);
      }

      // Roll the billed quantity forward on the PO lines (best-effort; the
      // authoritative value is derivable from these bill lines).
      for (const [poLineId, delta] of billedDeltasByPoLine) {
        await applyBilledDelta(input.organizationId, poLineId, delta, dataAdapterMode, nowIso);
      }
      await bestEffort(() => recordVendorBillCreated(ctx, bill.id, { billNumber, supplierId: input.supplierId, totalAmountCents: bill.totalAmountCents }, dataAdapterMode));
      return { bill, lineItems };
    }),
  );
}

// --- Void bill --------------------------------------------------------------

export async function voidVendorBill(organizationId: string, vendorBillId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode, params: { reason?: string; performedByStaffProfileId?: string | null; idFactory: () => string; now?: string }): Promise<VendorBill> {
  return withAggregateLease(vendorBillLeaseKey(organizationId, vendorBillId), dataAdapterMode, (handle) =>
    commitLeasedWrite(handle, dataAdapterMode, async () => {
      const bill = await getBillById(organizationId, vendorBillId, dataAdapterMode);
      if (!bill) throw new AccountsPayableServiceError('Bill not found.', 'not_found');
      if (bill.status === 'void') throw new AccountsPayableServiceError('Bill is already void.', 'invalid_state');
      if (bill.amountPaidCents > 0) throw new AccountsPayableServiceError('Cannot void a bill with recorded payments — reverse the payments first.', 'invalid_state');
      const nowIso = params.now ?? new Date().toISOString();

      // Reverse the posted bill entry (never delete). Immutable history stays.
      if (bill.journalEntryId) {
        await reverseJournalEntry(organizationId, bill.journalEntryId, { reason: params.reason ?? `Void of vendor bill ${bill.billNumber}`, performedByStaffProfileId: params.performedByStaffProfileId ?? null, idFactory: params.idFactory, now: nowIso }, dataAdapterMode);
      }

      // Reverse the PO billed rollups this bill contributed.
      const lines = await listLineItemsForBill(organizationId, vendorBillId, dataAdapterMode);
      for (const l of lines) {
        if (l.lineKind === 'goods' && l.purchaseOrderLineItemId && l.quantityBilled) {
          await applyBilledDelta(organizationId, l.purchaseOrderLineItemId, -l.quantityBilled, dataAdapterMode, nowIso);
        }
      }

      const next = await persistBillUpdate(bill, { status: 'void', updatedAt: nowIso }, dataAdapterMode);
      await bestEffort(() => recordVendorBillVoided(ctx, bill.id, bill.billNumber, dataAdapterMode));
      return next;
    }),
  );
}

// --- Record payment ---------------------------------------------------------

export type RecordBillPaymentInput = {
  organizationId: string;
  vendorBillId: string;
  amountCents: number;
  paymentDate: string;
  method: BillPaymentMethod;
  referenceNumber?: string | null;
  cashAccountNumber: string;
  notes?: string | null;
  createdByStaffProfileId?: string | null;
  idFactory: () => string;
  now?: string;
};

export async function recordBillPayment(input: RecordBillPaymentInput, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<{ payment: BillPayment; bill: VendorBill }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new AccountsPayableServiceError('Payment amount must be a positive integer number of cents.', 'invalid_input');
  await assertValidCashAccount(input.organizationId, input.cashAccountNumber, dataAdapterMode);

  return withAggregateLease(vendorBillLeaseKey(input.organizationId, input.vendorBillId), dataAdapterMode, (handle) =>
    commitLeasedWrite(handle, dataAdapterMode, async () => {
      const bill = await getBillById(input.organizationId, input.vendorBillId, dataAdapterMode);
      if (!bill) throw new AccountsPayableServiceError('Bill not found.', 'not_found');
      if (bill.status === 'void') throw new AccountsPayableServiceError('Cannot pay a void bill.', 'invalid_state');
      if (bill.status === 'paid') throw new AccountsPayableServiceError('Bill is already fully paid.', 'invalid_state');
      const remaining = bill.totalAmountCents - bill.amountPaidCents;
      if (input.amountCents > remaining) throw new AccountsPayableServiceError(`Over-pay: ${remaining} cent(s) remain on this bill, cannot pay ${input.amountCents}.`, 'over_pay');

      const nowIso = input.now ?? new Date().toISOString();
      const paymentId = input.idFactory();
      const sourceReferenceId = `ap-billpay-${paymentId}`;

      // Dr 2000 AP / Cr cash — record of an externally-executed payment.
      let journalEntryId: string | null = null;
      if (!(await alreadyPosted(input.organizationId, 'bill_payment', sourceReferenceId, dataAdapterMode))) {
        const postingLines = buildBillPaymentPosting(input.cashAccountNumber, input.amountCents);
        const lines = [] as Array<{ accountId: string; direction: 'debit' | 'credit'; amount: number }>;
        for (const l of postingLines) {
          lines.push({ accountId: await resolveAccountId(input.organizationId, l.accountNumber, input.idFactory, dataAdapterMode), direction: l.direction, amount: l.amount });
        }
        const { entry } = await createAndPostJournalEntry(
          input.organizationId,
          { entryDate: input.paymentDate, sourceType: 'bill_payment', sourceReferenceId, memo: `Vendor payment for bill ${bill.billNumber} (${input.method})`, lines, postedByStaffProfileId: input.createdByStaffProfileId ?? null, idFactory: input.idFactory, now: nowIso },
          dataAdapterMode,
        );
        journalEntryId = entry.id;
      }

      const payment: BillPayment = {
        id: paymentId,
        organizationId: input.organizationId,
        vendorBillId: input.vendorBillId,
        supplierId: bill.supplierId,
        amountCents: input.amountCents,
        paymentDate: input.paymentDate,
        method: input.method,
        referenceNumber: input.referenceNumber ?? null,
        cashAccountNumber: input.cashAccountNumber,
        journalEntryId,
        notes: input.notes ?? null,
        createdByStaffProfileId: input.createdByStaffProfileId ?? null,
        createdAt: nowIso,
      };
      if (dataAdapterMode === 'mock') billPaymentFixtures.push(payment);
      else await insertWixDataItem('billPayments', buildWixBillPaymentData(payment), payment.id);

      const amountPaidCents = bill.amountPaidCents + input.amountCents;
      const status: VendorBillStatus = amountPaidCents >= bill.totalAmountCents ? 'paid' : 'partially_paid';
      const nextBill = await persistBillUpdate(bill, { status, amountPaidCents, updatedAt: nowIso }, dataAdapterMode);
      await bestEffort(() => recordBillPaymentRecorded(ctx, payment.id, { vendorBillId: input.vendorBillId, amountCents: input.amountCents, method: input.method }, dataAdapterMode));
      return { payment, bill: nextBill };
    }),
  );
}

// --- internals --------------------------------------------------------------

async function alreadyPosted(organizationId: string, sourceType: string, sourceReferenceId: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  const entries = await listJournalEntriesForOrganization(organizationId, dataAdapterMode);
  return entries.some((e) => e.sourceType === sourceType && e.sourceReferenceId === sourceReferenceId);
}

async function persistBillUpdate(bill: VendorBill, patch: Partial<Pick<VendorBill, 'status' | 'amountPaidCents' | 'journalEntryId' | 'notes' | 'updatedAt'>>, dataAdapterMode: DataAdapterMode): Promise<VendorBill> {
  const next: VendorBill = { ...bill, ...patch };
  if (dataAdapterMode === 'mock') {
    const idx = vendorBillFixtures.findIndex((b) => b.id === bill.id);
    if (idx >= 0) vendorBillFixtures[idx] = next;
    return next;
  }
  const response = await queryWixDataItems<WixVendorBillItem>('vendorBills', { filter: { organizationId: bill.organizationId, beaconVendorBillId: bill.id }, paging: { limit: 1 } });
  const raw = response.dataItems[0]?.data;
  if (!raw) throw new AccountsPayableServiceError('Bill not found.', 'not_found');
  await updateWixDataItem('vendorBills', bill.id, applyVendorBillUpdateToWixData(raw, patch));
  return next;
}

async function bestEffort(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    /* swallow */
  }
}
