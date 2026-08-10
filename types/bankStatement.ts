/**
 * Phase 31 (Financial Management & General Ledger). Bank statement import
 * and reconciliation matching — the least-precedented part of this phase
 * (no prior Beacon feature imports/reconciles external data), so kept
 * fully concrete rather than sketched. See
 * docs/adr/ADR-035-financial-management-and-general-ledger.md.
 *
 * A `BankStatementImport` is the header record for one imported file; each
 * `BankStatementLine` is one raw transaction from it.
 *
 * **Matching algorithm** (see `services/bankingService.ts#runAutoMatch`):
 * for each `unmatched` line, candidates are `JournalEntryLine`s against
 * the account's linked `ledgerAccountId` where `amount`/sign match
 * exactly and the parent `JournalEntry.entryDate` is within a ±3-day
 * window, excluding entries already matched elsewhere. Exactly one
 * candidate auto-matches; zero or multiple are left `unmatched` for a
 * human (`manuallyMatchStatementLine` or `excludeStatementLine`, the
 * latter for bank-only events like fees that have no corresponding
 * Beacon-authored entry yet — a named, disclosed gap: staff must
 * separately post a manual adjustment for those before a reconciliation
 * can balance).
 */
export type BankStatementImport = {
  id: string;
  organizationId: string;
  bankAccountId: string;
  importedAt: string;
  fileName: string | null;
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
  lineCount: number;
  createdByStaffProfileId: string | null;
};

export type BankStatementLineMatchStatus = 'unmatched' | 'auto_matched' | 'manually_matched' | 'excluded';

export type BankStatementLine = {
  id: string;
  organizationId: string;
  bankStatementImportId: string;
  bankAccountId: string;
  transactionDate: string;
  description: string;
  /** Signed cents — positive = deposit, negative = withdrawal. The one
      deliberate exception to every other financial amount in this phase
      being "always positive + an explicit direction field," since this is
      raw external data, not an internally-authored line. */
  amount: number;
  matchedJournalEntryId: string | null;
  matchStatus: BankStatementLineMatchStatus;
  createdAt: string;
};
