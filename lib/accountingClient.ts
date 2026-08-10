import type { LedgerAccount, LedgerAccountType, LedgerAccountNormalBalance } from '@/types/ledgerAccount';
import type { JournalEntry, JournalEntryLine } from '@/types/journalEntry';
import type { CaseWriteOff } from '@/types/caseWriteOff';
import type { BankAccount } from '@/types/bankAccount';
import type { BankDeposit } from '@/types/bankDeposit';
import type { BankStatementImport, BankStatementLine } from '@/types/bankStatement';
import type { BankReconciliation } from '@/types/bankReconciliation';
import type {
  TrialBalanceReportRow,
  GeneralLedgerDetailRow,
  BalanceSheetReport,
  ProfitAndLossReport,
  ArAgingRow,
  TransactionRegisterRow,
} from '@/services/financialReportsService';

/**
 * Phase 31 (Financial Management & General Ledger). Client-side fetch
 * wrappers around `/api/accounting/*` — matches every other `lib/*Client.ts`
 * module's reasoning (`services/chartOfAccountsService.ts` et al. import
 * `lib/wixDataApi.ts`, server-only, and can never be imported into a
 * Client Component). Deliberately named `accountingClient.ts`, not
 * `chartOfAccountsService.ts`/etc., to avoid colliding with the real
 * server-only service files of the same domain.
 */

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

// --- Chart of Accounts ---

export async function fetchChartOfAccounts(organizationId: string): Promise<LedgerAccount[]> {
  const response = await fetch(`/api/accounting/chart-of-accounts?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await parseJsonOrThrow(response);
  return (body.accounts as LedgerAccount[]) ?? [];
}

export async function createLedgerAccount(params: {
  organizationId: string;
  accountNumber: string;
  name: string;
  accountType: LedgerAccountType;
  normalBalance: LedgerAccountNormalBalance;
  parentAccountId?: string | null;
  description?: string | null;
}): Promise<LedgerAccount> {
  const response = await fetch('/api/accounting/chart-of-accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrThrow(response);
  return body.account as LedgerAccount;
}

export async function deactivateLedgerAccount(organizationId: string, accountId: string): Promise<LedgerAccount> {
  const response = await fetch(`/api/accounting/chart-of-accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, deactivate: true }),
  });
  const body = await parseJsonOrThrow(response);
  return body.account as LedgerAccount;
}

// --- Journal Entries ---

export async function fetchJournalEntries(organizationId: string): Promise<JournalEntry[]> {
  const response = await fetch(`/api/accounting/journal-entries?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await parseJsonOrThrow(response);
  return (body.entries as JournalEntry[]) ?? [];
}

export async function fetchJournalEntryDetail(organizationId: string, entryId: string): Promise<{ entry: JournalEntry; lines: JournalEntryLine[] }> {
  const response = await fetch(`/api/accounting/journal-entries/${encodeURIComponent(entryId)}?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await parseJsonOrThrow(response);
  return { entry: body.entry as JournalEntry, lines: (body.lines as JournalEntryLine[]) ?? [] };
}

export async function createManualJournalEntry(params: {
  organizationId: string;
  entryDate: string;
  memo: string;
  lines: Array<{ accountId: string; direction: 'debit' | 'credit'; amount: number }>;
}): Promise<{ entry: JournalEntry; lines: JournalEntryLine[] }> {
  const response = await fetch('/api/accounting/journal-entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrThrow(response);
  return { entry: body.entry as JournalEntry, lines: body.lines as JournalEntryLine[] };
}

export async function postJournalEntry(organizationId: string, entryId: string): Promise<JournalEntry> {
  const response = await fetch(`/api/accounting/journal-entries/${encodeURIComponent(entryId)}/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  const body = await parseJsonOrThrow(response);
  return body.entry as JournalEntry;
}

export async function voidJournalEntry(organizationId: string, entryId: string): Promise<JournalEntry> {
  const response = await fetch(`/api/accounting/journal-entries/${encodeURIComponent(entryId)}/void`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  const body = await parseJsonOrThrow(response);
  return body.entry as JournalEntry;
}

export async function reverseJournalEntry(organizationId: string, entryId: string, reason: string): Promise<{ entry: JournalEntry; lines: JournalEntryLine[] }> {
  const response = await fetch(`/api/accounting/journal-entries/${encodeURIComponent(entryId)}/reverse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, reason }),
  });
  const body = await parseJsonOrThrow(response);
  return { entry: body.entry as JournalEntry, lines: body.lines as JournalEntryLine[] };
}

// --- Transactions: write-offs / adjustments / transfers / refunds ---

export async function postWriteOff(params: { organizationId: string; caseId: string; amountCents: number; reason: string }): Promise<{ writeOff: CaseWriteOff }> {
  const response = await fetch('/api/accounting/write-offs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrThrow(response);
  return { writeOff: body.writeOff as CaseWriteOff };
}

export async function postAdjustment(params: {
  organizationId: string;
  debitAccountId: string;
  creditAccountId: string;
  amountCents: number;
  memo: string;
  caseId?: string | null;
}): Promise<JournalEntry> {
  const response = await fetch('/api/accounting/adjustments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrThrow(response);
  return body.entry as JournalEntry;
}

export async function postTransfer(params: {
  organizationId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountCents: number;
  memo: string;
}): Promise<JournalEntry> {
  const response = await fetch('/api/accounting/transfers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrThrow(response);
  return body.entry as JournalEntry;
}

export async function refundPayment(organizationId: string, caseId: string, paymentId: string): Promise<JournalEntry> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  const body = await parseJsonOrThrow(response);
  return body.entry as JournalEntry;
}

// --- Banking ---

export async function fetchBankAccounts(organizationId: string): Promise<BankAccount[]> {
  const response = await fetch(`/api/accounting/banking/accounts?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await parseJsonOrThrow(response);
  return (body.accounts as BankAccount[]) ?? [];
}

export async function createBankAccountClient(params: {
  organizationId: string;
  name: string;
  ledgerAccountId: string;
  accountNumberLast4?: string | null;
  bankName?: string | null;
}): Promise<BankAccount> {
  const response = await fetch('/api/accounting/banking/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrThrow(response);
  return body.account as BankAccount;
}

export async function deactivateBankAccountClient(organizationId: string, bankAccountId: string): Promise<BankAccount> {
  const response = await fetch(`/api/accounting/banking/accounts/${encodeURIComponent(bankAccountId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, deactivate: true }),
  });
  const body = await parseJsonOrThrow(response);
  return body.account as BankAccount;
}

export async function fetchBankDeposits(organizationId: string): Promise<BankDeposit[]> {
  const response = await fetch(`/api/accounting/banking/deposits?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await parseJsonOrThrow(response);
  return (body.deposits as BankDeposit[]) ?? [];
}

export async function createBankDeposit(params: { organizationId: string; bankAccountLedgerAccountId: string; paymentIds: string[]; memo?: string | null }): Promise<{ deposit: BankDeposit }> {
  const response = await fetch('/api/accounting/banking/deposits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrThrow(response);
  return { deposit: body.deposit as BankDeposit };
}

export async function importBankStatementClient(params: {
  organizationId: string;
  bankAccountId: string;
  fileName?: string | null;
  lines: Array<{ transactionDate: string; description: string; amount: number }>;
}): Promise<{ statementImport: BankStatementImport; lines: BankStatementLine[]; autoMatchedCount: number }> {
  const response = await fetch('/api/accounting/banking/statement-imports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrThrow(response);
  return {
    statementImport: body.statementImport as BankStatementImport,
    lines: (body.lines as BankStatementLine[]) ?? [],
    autoMatchedCount: (body.autoMatchedCount as number) ?? 0,
  };
}

export async function fetchStatementImportLines(organizationId: string, importId: string): Promise<BankStatementLine[]> {
  const response = await fetch(`/api/accounting/banking/statement-imports/${encodeURIComponent(importId)}/lines?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await parseJsonOrThrow(response);
  return (body.lines as BankStatementLine[]) ?? [];
}

export async function manuallyMatchStatementLineClient(organizationId: string, lineId: string, journalEntryId: string): Promise<BankStatementLine> {
  const response = await fetch(`/api/accounting/banking/statement-lines/${encodeURIComponent(lineId)}/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, journalEntryId }),
  });
  const body = await parseJsonOrThrow(response);
  return body.line as BankStatementLine;
}

export async function excludeStatementLineClient(organizationId: string, lineId: string): Promise<BankStatementLine> {
  const response = await fetch(`/api/accounting/banking/statement-lines/${encodeURIComponent(lineId)}/exclude`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  const body = await parseJsonOrThrow(response);
  return body.line as BankStatementLine;
}

export async function fetchReconciliations(organizationId: string, bankAccountId: string): Promise<BankReconciliation[]> {
  const response = await fetch(
    `/api/accounting/banking/reconciliations?organizationId=${encodeURIComponent(organizationId)}&bankAccountId=${encodeURIComponent(bankAccountId)}`,
  );
  const body = await parseJsonOrThrow(response);
  return (body.reconciliations as BankReconciliation[]) ?? [];
}

export async function startBankReconciliation(params: {
  organizationId: string;
  bankAccountId: string;
  statementEndingDate: string;
  statementEndingBalance: number;
  bankStatementImportId?: string | null;
}): Promise<BankReconciliation> {
  const response = await fetch('/api/accounting/banking/reconciliations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrThrow(response);
  return body.reconciliation as BankReconciliation;
}

export async function completeBankReconciliation(
  organizationId: string,
  reconciliationId: string,
): Promise<{ reconciliation: BankReconciliation; variance: number; completed: boolean }> {
  const response = await fetch(`/api/accounting/banking/reconciliations/${encodeURIComponent(reconciliationId)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  const body = await parseJsonOrThrow(response);
  return { reconciliation: body.reconciliation as BankReconciliation, variance: body.variance as number, completed: body.completed as boolean };
}

// --- Reports ---

export async function fetchTrialBalanceReport(organizationId: string): Promise<{ rows: TrialBalanceReportRow[]; totalDebits: number; totalCredits: number }> {
  const response = await fetch(`/api/accounting/reports/trial-balance?organizationId=${encodeURIComponent(organizationId)}`);
  return (await parseJsonOrThrow(response)) as unknown as { rows: TrialBalanceReportRow[]; totalDebits: number; totalCredits: number };
}

export async function fetchGeneralLedgerReport(organizationId: string, accountId: string): Promise<{ account: LedgerAccount; rows: GeneralLedgerDetailRow[]; endingBalance: number }> {
  const response = await fetch(`/api/accounting/reports/general-ledger?organizationId=${encodeURIComponent(organizationId)}&accountId=${encodeURIComponent(accountId)}`);
  return (await parseJsonOrThrow(response)) as unknown as { account: LedgerAccount; rows: GeneralLedgerDetailRow[]; endingBalance: number };
}

export async function fetchBalanceSheetReport(organizationId: string): Promise<BalanceSheetReport> {
  const response = await fetch(`/api/accounting/reports/balance-sheet?organizationId=${encodeURIComponent(organizationId)}`);
  return (await parseJsonOrThrow(response)) as unknown as BalanceSheetReport;
}

export async function fetchProfitAndLossReport(organizationId: string): Promise<ProfitAndLossReport> {
  const response = await fetch(`/api/accounting/reports/profit-and-loss?organizationId=${encodeURIComponent(organizationId)}`);
  return (await parseJsonOrThrow(response)) as unknown as ProfitAndLossReport;
}

export async function fetchArAgingReport(organizationId: string): Promise<{ rows: ArAgingRow[]; totalOutstanding: number; glAccountsReceivableBalance: number; reconciles: boolean }> {
  const response = await fetch(`/api/accounting/reports/ar-aging?organizationId=${encodeURIComponent(organizationId)}`);
  return (await parseJsonOrThrow(response)) as unknown as { rows: ArAgingRow[]; totalOutstanding: number; glAccountsReceivableBalance: number; reconciles: boolean };
}

export async function fetchTransactionRegisterReport(organizationId: string): Promise<{ rows: TransactionRegisterRow[] }> {
  const response = await fetch(`/api/accounting/reports/transaction-register?organizationId=${encodeURIComponent(organizationId)}`);
  return (await parseJsonOrThrow(response)) as unknown as { rows: TransactionRegisterRow[] };
}
