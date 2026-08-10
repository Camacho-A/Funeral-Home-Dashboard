/**
 * Phase 31 (Financial Management & General Ledger). The Chart of Accounts —
 * every `LedgerAccount` is organization-scoped, and every posted
 * `JournalEntryLine` (types/journalEntry.ts) references exactly one of
 * these. See docs/adr/ADR-035-financial-management-and-general-ledger.md.
 *
 * `accountType` is immutable once created — every derived report (Trial
 * Balance, Balance Sheet, Profit & Loss) groups by it, so changing it after
 * journal lines exist against the account would silently corrupt every
 * report that already grouped by the old type. `normalBalance` is derived
 * from `accountType` at creation time (asset/expense = debit,
 * liability/equity/revenue = credit) and stored for query convenience —
 * never recomputed elsewhere.
 *
 * `isSystemAccount` marks a starter account seeded by
 * `services/chartOfAccountsService.ts#seedChartOfAccounts` (mirroring
 * `services/organizationProvisioningService.ts#seedServiceCatalog`'s own
 * per-org starter-data convention) — these can never be deactivated,
 * unlike a custom account an organization adds itself. `isActive` is the
 * only lifecycle transition; a `LedgerAccount` is never hard-deleted, since
 * historical journal lines must remain attributable to it forever.
 *
 * `accountNumber` is a clean, user-facing display value (e.g. "1200") —
 * deliberately NOT where org-scoped uniqueness is enforced, unlike
 * `PaymentRecord.idempotencyKey` (an internal token, never displayed,
 * where composing `{organizationId}:{value}` directly into the field is
 * harmless). Composing that same value into a *user-visible* account
 * number would show a garbled string in the Chart of Accounts UI. Instead,
 * `accountNumberKey` is a separate, internal-only field holding
 * `{organizationId}:{accountNumber}` — that field carries the real Wix
 * unique index, so a genuine Wix Data insert-conflict (not a
 * check-then-insert race) is what actually prevents two accounts sharing
 * a number within one organization. */
export type LedgerAccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type LedgerAccountNormalBalance = 'debit' | 'credit';

export type LedgerAccount = {
  id: string;
  organizationId: string;
  /** Clean, user-facing display value, e.g. "1200" — see this file's own
      header comment on why uniqueness is NOT enforced on this field
      directly. */
  accountNumber: string;
  /** Internal only, never displayed — `{organizationId}:{accountNumber}`,
      the field the real Wix unique index actually sits on. */
  accountNumberKey: string;
  name: string;
  /** Immutable once created — see this file's own header comment. */
  accountType: LedgerAccountType;
  /** Derived from `accountType` at creation; never recomputed. */
  normalBalance: LedgerAccountNormalBalance;
  /** -> LedgerAccount.id. Must belong to the same organization and share
      the same `accountType` as its parent — enforced at creation, not
      re-validated afterward (an org's chart is small; malformed hierarchy
      would be caught immediately during setup). */
  parentAccountId: string | null;
  /** A starter account seeded by `seedChartOfAccounts` — never
      deactivatable, unlike an organization-added custom account. */
  isSystemAccount: boolean;
  /** The only lifecycle transition — never hard-deleted. */
  isActive: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};
