/**
 * Phase 36 (Procurement & Accounts Payable). A record of an
 * EXTERNALLY-EXECUTED vendor payment against a bill. Solis records the
 * payment (amount, date, method, external reference, cash account, actor,
 * bill allocation, accounting posting, audit history) but NEVER initiates or
 * transmits an actual bank/ACH/card payment — exactly as banking deposits
 * are recorded, not executed. This is the VENDOR (outgoing) side and is
 * wholly separate from the customer-facing `PaymentRecord` (incoming); the
 * two are never interchanged. See
 * docs/adr/ADR-040-procurement-and-accounts-payable.md.
 *
 * Posting a payment writes ONE balanced `bill_payment` journal entry: Dr
 * 2000 Accounts Payable / Cr the chosen cash/bank account. Multiple partial
 * payments per bill are first-class.
 */
export type BillPaymentMethod = 'check' | 'ach' | 'card' | 'cash' | 'other';

export type BillPayment = {
  id: string;
  organizationId: string;
  vendorBillId: string;
  /** Denormalized for supplier-spend reporting. */
  supplierId: string;
  amountCents: number;
  paymentDate: string;
  method: BillPaymentMethod;
  /** Check number / ACH reference / card auth / etc. Null ⇒ none. */
  referenceNumber: string | null;
  /** The cash/bank account NUMBER credited (Cr) — validated to be an asset
      cash/bank account. */
  cashAccountNumber: string;
  /** The `bill_payment` journal entry id, set once posted. */
  journalEntryId: string | null;
  notes: string | null;
  /** The StaffProfile that recorded the payment (StaffProfile-space, never
      Identity). */
  createdByStaffProfileId: string | null;
  createdAt: string;
};
