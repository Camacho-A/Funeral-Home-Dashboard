/**
 * Phase 31 (Financial Management & General Ledger). One organization's own
 * bank account, distinct from the `LedgerAccount` it represents — every
 * `BankAccount` links 1:1 to a Cash-type `LedgerAccount` (its
 * `ledgerAccountId`), so the account's real, derived balance is always
 * `services/generalLedgerService.ts#getAccountBalance`, never a second,
 * separately-tracked figure. See
 * docs/adr/ADR-035-financial-management-and-general-ledger.md.
 *
 * `accountNumberLast4` mirrors `PaymentRecord.cardLast4`'s existing
 * PCI-safe precedent — the one account-number-adjacent value that's
 * standard to display and store; never a full account/routing number.
 */
export type BankAccount = {
  id: string;
  organizationId: string;
  name: string;
  /** -> LedgerAccount.id — must reference a Cash-type account. */
  ledgerAccountId: string;
  accountNumberLast4: string | null;
  bankName: string | null;
  /** The only lifecycle transition — never hard-deleted. */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
