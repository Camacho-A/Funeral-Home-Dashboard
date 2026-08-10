/**
 * Phase 31 (Financial Management & General Ledger). One reconciliation
 * pass for one `BankAccount` against one imported statement. See
 * docs/adr/ADR-035-financial-management-and-general-ledger.md.
 *
 * **"Reconciled" is an audit marker only, never a second source of
 * truth.** A `BankAccount`'s real, current balance is always
 * `services/generalLedgerService.ts#getAccountBalance` — this record's
 * `statementEndingBalance` is only ever displayed as a point-in-time
 * confirmation ("last reconciled through 7/31 at $X"), never recomputed
 * as the account's live figure. `completeReconciliation` validates
 * `bookBalanceAtStart + sum(matched line amounts) === statementEndingBalance`
 * and returns the variance rather than silently completing if it doesn't.
 */
export type BankReconciliationStatus = 'in_progress' | 'completed';

export type BankReconciliation = {
  id: string;
  organizationId: string;
  bankAccountId: string;
  statementEndingDate: string;
  statementEndingBalance: number;
  /** A snapshot for audit only — never authoritative, always
      re-derivable from the ledger. */
  bookBalanceAtStart: number;
  status: BankReconciliationStatus;
  bankStatementImportId: string | null;
  completedAt: string | null;
  completedByStaffProfileId: string | null;
  createdAt: string;
};
