/**
 * Phase 36 (Procurement & Accounts Payable). A supplier's invoice — the
 * document that establishes a real Accounts Payable (2000) liability and
 * clears the receiving GRNI accrual (2100). Posting a bill writes ONE
 * balanced `bill` journal entry (see domain/ledger/vendorBillPosting.ts):
 *   Dr 2100 Inventory Clearing (goods GRNI cleared)
 *   Dr/Cr 5120 Purchase Price Variance (justified goods price difference)
 *   Dr <expense/asset account> (each non-goods charge)
 *   Cr 2000 Accounts Payable (the full supplier liability)
 *
 * A posted bill is immutable: it is corrected only by VOID (which reverses
 * its journal entry via generalLedgerService.reverseJournalEntry, never
 * edits or deletes it) — preserving historical accounting auditability. A
 * bill with `purchaseOrderId: null` is an expense-only bill (freight,
 * services): it posts against explicit expense/asset accounts and NEVER
 * creates inventory quantities or a fake receipt. See
 * docs/adr/ADR-040-procurement-and-accounts-payable.md.
 */
export type VendorBillStatus = 'open' | 'partially_paid' | 'paid' | 'void';

export type VendorBill = {
  id: string;
  organizationId: string;
  /** The supplier's own invoice number — unique per supplier (application-
      enforced). */
  billNumber: string;
  supplierId: string;
  /** The PO whose receipts this bill covers; null for an expense-only bill. */
  purchaseOrderId: string | null;
  billDate: string;
  dueDate: string;
  status: VendorBillStatus;
  /** Σ goods bill-line billed amounts (cents). */
  goodsAmountCents: number;
  /** Σ expense (non-goods) bill-line amounts (cents). */
  additionalChargesCents: number;
  /** goodsAmountCents + additionalChargesCents — the AP liability (cents). */
  totalAmountCents: number;
  /** Running Σ of recorded payments against this bill (cents). */
  amountPaidCents: number;
  /** Net purchase-price variance for reporting: positive = unfavorable
      (billed above receipt cost), negative = favorable. */
  netVarianceCents: number;
  /** The `bill` journal entry id, set once posted. Null only transiently /
      for a never-posted draft. */
  journalEntryId: string | null;
  notes: string | null;
  /** The StaffProfile that entered the bill (StaffProfile-space, never
      Identity). */
  createdByStaffProfileId: string | null;
  createdAt: string;
  updatedAt: string;
};
