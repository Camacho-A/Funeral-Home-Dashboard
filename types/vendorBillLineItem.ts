/**
 * Phase 36 (Procurement & Accounts Payable). A first-class vendor-bill line.
 * Bill lines are their own records (not JSON on the bill) because they
 * participate in three-way matching, partial matching, quantity/price
 * variance, account coding, non-PO expense bills, reporting, auditability,
 * and future extensions (vendor credits). See
 * docs/adr/ADR-040-procurement-and-accounts-payable.md.
 *
 * `lineKind: 'goods'` bills a specific authoritative receipt (an
 * `inventory_receipt` movement) — three-way matching compares the PO line,
 * that receipt, and this bill line. Clearing `grniValueCents` from account
 * 2100 for `quantityBilled` units, at the supplier's `billedUnitCostCents`,
 * yields a per-line `varianceCents`. "How much of a receipt is billed" is
 * DERIVED by summing non-void goods lines that reference it — the immutable
 * receipt movement is never mutated, so partial billing and void-reopens-GRNI
 * both fall out for free.
 *
 * `lineKind: 'expense'` is a non-goods charge (freight, service): it debits
 * an explicit `expenseAccountNumber` and NEVER touches inventory (1300),
 * GRNI (2100), or AP (2000) itself — it cannot manufacture an inventory
 * receipt.
 *
 * `productDescriptionSnapshot` preserves the product/supplier description as
 * billed — an immutable historical snapshot independent of later catalog
 * edits.
 */
export type VendorBillLineKind = 'goods' | 'expense';

export type VendorBillLineItem = {
  id: string;
  organizationId: string;
  vendorBillId: string;
  lineNumber: number;
  lineKind: VendorBillLineKind;

  // --- goods lines (null on expense lines) ---
  /** The authoritative `inventory_receipt` movement this line bills. */
  receiptMovementId: string | null;
  /** The PO line this receipt fulfilled — three-way-match context. */
  purchaseOrderLineItemId: string | null;
  productId: string | null;
  /** Immutable product/supplier description as billed. */
  productDescriptionSnapshot: string | null;
  /** Units of the receipt billed by this line. */
  quantityBilled: number | null;
  /** The 2100 GRNI amount cleared for this line (receipt cost basis, cents). */
  grniValueCents: number | null;
  /** The supplier's per-unit charge (cents). */
  billedUnitCostCents: number | null;
  /** Per-line variance = lineAmountCents − grniValueCents (cents): positive
      = unfavorable, negative = favorable. */
  varianceCents: number | null;

  // --- expense lines (null on goods lines) ---
  /** The expense/asset account NUMBER debited (never 1300/2100/2000). */
  expenseAccountNumber: string | null;
  expenseDescription: string | null;

  // --- both ---
  /** Goods: quantityBilled × billedUnitCostCents. Expense: the charge. Cents. */
  lineAmountCents: number;
  createdAt: string;
};
