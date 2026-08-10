/**
 * Phase 31 (Financial Management & General Ledger). Recording that one or
 * more `PaymentRecord`s (still sitting in Undeposited Funds) were swept
 * into a real bank account. See
 * docs/adr/ADR-035-financial-management-and-general-ledger.md.
 *
 * `includedPaymentRecordIds` is provenance only — it's never queried in
 * reverse (Wix Data's index API doesn't support "contains" filtering
 * anyway); instead, `PaymentRecord.depositedInBankDepositId` (see
 * types/payment.ts) is the field every other lookup actually uses,
 * letting a payment's own row answer "has this been deposited yet"
 * directly.
 */
export type BankDeposit = {
  id: string;
  organizationId: string;
  bankAccountId: string;
  depositDate: string;
  totalAmount: number;
  /** Provenance list only — fetched by known id, never indexed/queried. */
  includedPaymentRecordIds: string[];
  /** -> JournalEntry.id — the Dr Cash-Bank / Cr Undeposited Funds entry
      this deposit posted. */
  journalEntryId: string;
  memo: string | null;
  createdAt: string;
  /** StaffProfile-space — see types/journalEntry.ts's own comment on why. */
  createdByStaffProfileId: string | null;
};
