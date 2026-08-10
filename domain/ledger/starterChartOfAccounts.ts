import type { LedgerAccountType, LedgerAccountNormalBalance } from '../../types/ledgerAccount';

/**
 * Phase 31 (Financial Management & General Ledger). Platform-owned starter
 * chart of accounts — plain in-code data, the same "materialize into
 * organization-owned rows, never a shared cross-org template row" pattern
 * as `domain/onboarding/starterServiceCatalog.ts`.
 * `services/chartOfAccountsService.ts`'s `seedChartOfAccounts` writes a
 * fresh, independent `chartOfAccounts` row per entry for the organization
 * — never a reference to another organization's own rows.
 *
 * Numbering convention: 1000s Assets, 2000s Liabilities (reserved — no
 * accounts-payable feature in this phase, so none seeded), 3000s Equity,
 * 4000s Revenue, 5000s Expense. `1010`+ (one Cash-Bank account per
 * `BankAccount`) is deliberately NOT seeded here — `bankingService.ts`'s
 * `createBankAccount` creates that linked `LedgerAccount` itself, at the
 * moment a real bank account is actually added, since none exist yet for
 * a brand-new organization.
 */
/** Named constants for the starter accounts `financialTransactionService.ts`
    posts against directly — avoids magic string literals scattered across
    every transaction-posting function. Only the accounts a system-generated
    transaction actually needs to look up by number are named here. */
export const STARTER_ACCOUNT_NUMBERS = {
  CASH_OPERATING: '1000',
  UNDEPOSITED_FUNDS: '1100',
  ACCOUNTS_RECEIVABLE: '1200',
  RETAINED_EARNINGS: '3000',
  LEGACY_OPENING_BALANCE: '3010',
  SERVICE_REVENUE: '4000',
  BAD_DEBT_EXPENSE: '5000',
  BANK_FEES_EXPENSE: '5010',
} as const;

export type StarterLedgerAccountEntry = {
  accountNumber: string;
  name: string;
  accountType: LedgerAccountType;
  normalBalance: LedgerAccountNormalBalance;
  description: string;
};

export const STARTER_CHART_OF_ACCOUNTS: StarterLedgerAccountEntry[] = [
  { accountNumber: '1000', name: 'Cash - Operating', accountType: 'asset', normalBalance: 'debit', description: 'Cash on hand, not yet deposited to a specific bank account.' },
  { accountNumber: '1100', name: 'Undeposited Funds', accountType: 'asset', normalBalance: 'debit', description: 'Payments collected but not yet swept into a bank deposit.' },
  { accountNumber: '1200', name: 'Accounts Receivable', accountType: 'asset', normalBalance: 'debit', description: "Amounts owed by families for services rendered — this account's derived balance reconciles with the sum of open CaseOrder.balanceDue values." },
  { accountNumber: '3000', name: 'Retained Earnings', accountType: 'equity', normalBalance: 'credit', description: 'Accumulated net income carried forward.' },
  { accountNumber: '3010', name: 'Legacy Opening Balance', accountType: 'equity', normalBalance: 'credit', description: "Fallback counter-account for services/financialBackfillMigrationService.ts's one-time historical backfill, used only for a payment whose original case can no longer be resolved — named and disclosed rather than silently skipped or booked against Accounts Receivable with no real receivable behind it." },
  { accountNumber: '4000', name: 'Service Revenue', accountType: 'revenue', normalBalance: 'credit', description: 'Revenue earned from cremation and related services.' },
  { accountNumber: '5000', name: 'Bad Debt Expense', accountType: 'expense', normalBalance: 'debit', description: 'Amounts written off as uncollectible.' },
  { accountNumber: '5010', name: 'Bank Fees Expense', accountType: 'expense', normalBalance: 'debit', description: 'Bank service charges — reserved for reconciliation-fee handling, no automatic posting exists yet.' },
];
