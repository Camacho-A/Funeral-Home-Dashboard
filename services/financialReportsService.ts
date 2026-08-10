import type { DataAdapterMode } from '../lib/env';
import { listAccounts } from './chartOfAccountsService';
import {
  listJournalEntriesForOrganization,
  getJournalEntryWithLines,
  getAccountBalance,
  getTrialBalance as getRawTrialBalance,
} from './generalLedgerService';
import { listActiveCaseOrdersForOrganization, listCaseOrderVersions } from './pricingService';
import { getPaymentRecordById } from './paymentsService';
import { getBankDepositById } from './financialTransactionService';
import { bucketForAging, type ArAgingBucket } from '../domain/ledger/agingBuckets';
import type { LedgerAccount, LedgerAccountType } from '../types/ledgerAccount';
import type { JournalEntry } from '../types/journalEntry';

/**
 * Phase 31 (Financial Management & General Ledger). The 6 financial
 * reports — every one derives from `journalEntryLines`/`journalEntries`
 * fresh at request time (no caching, no stored aggregate — mirrors every
 * other service this phase), except AR Aging, which is cross-checked
 * against (never unified with) the GL's own derived Accounts Receivable
 * balance. See docs/adr/ADR-035-financial-management-and-general-ledger.md's
 * "Financial reports" section and its own "Disclosed, not solved" note on
 * why these re-scan all-time journal history at request time rather than
 * maintaining a period-snapshot.
 */

/** A credit-normal account's activity is naturally negative in
    `getAccountBalance`'s debit-positive convention (debit total minus
    credit total) — every report below displays the "natural," positive-
    when-expected figure a user actually expects to see (more revenue
    earned shows as a bigger positive number, not a bigger negative one). */
function displayAmount(accountType: LedgerAccountType, rawBalance: number): number {
  return accountType === 'liability' || accountType === 'equity' || accountType === 'revenue' ? -rawBalance : rawBalance;
}

async function accountMap(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<Map<string, LedgerAccount>> {
  const accounts = await listAccounts(organizationId, dataAdapterMode);
  return new Map(accounts.map((a) => [a.id, a]));
}

export type TrialBalanceReportRow = {
  accountId: string;
  accountNumber: string;
  accountName: string;
  accountType: LedgerAccountType;
  debitTotal: number;
  creditTotal: number;
};

export async function getTrialBalance(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
  asOfDate?: string,
): Promise<{ rows: TrialBalanceReportRow[]; totalDebits: number; totalCredits: number }> {
  const rawRows = await getRawTrialBalance(organizationId, dataAdapterMode, asOfDate);
  const accounts = await accountMap(organizationId, dataAdapterMode);

  const rows: TrialBalanceReportRow[] = rawRows
    .map((row) => {
      const account = accounts.get(row.accountId);
      if (!account) return null;
      return {
        accountId: row.accountId,
        accountNumber: account.accountNumber,
        accountName: account.name,
        accountType: account.accountType,
        debitTotal: row.debitTotal,
        creditTotal: row.creditTotal,
      };
    })
    .filter((row): row is TrialBalanceReportRow => row !== null)
    .sort((a, b) => (a.accountNumber < b.accountNumber ? -1 : 1));

  return {
    rows,
    totalDebits: rows.reduce((sum, r) => sum + r.debitTotal, 0),
    totalCredits: rows.reduce((sum, r) => sum + r.creditTotal, 0),
  };
}

export type GeneralLedgerDetailRow = {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  memo: string;
  direction: 'debit' | 'credit';
  amount: number;
  caseId: string | null;
};

/**
 * One account's full posted-entry history, filtered by an optional date
 * range — the "GL detail" drill-down every summary report's account row
 * links to.
 */
export async function getGeneralLedgerDetail(
  organizationId: string,
  accountId: string,
  dataAdapterMode: DataAdapterMode,
  options?: { fromDate?: string; toDate?: string },
): Promise<{ account: LedgerAccount; rows: GeneralLedgerDetailRow[]; endingBalance: number }> {
  const accounts = await accountMap(organizationId, dataAdapterMode);
  const account = accounts.get(accountId);
  if (!account) throw new Error(`No ledger account "${accountId}" exists in this organization.`);

  const entries = (await listJournalEntriesForOrganization(organizationId, dataAdapterMode, options)).filter((e) => e.status === 'posted');

  const rows: GeneralLedgerDetailRow[] = [];
  for (const entry of entries) {
    const withLines = await getJournalEntryWithLines(organizationId, entry.id, dataAdapterMode);
    if (!withLines) continue;
    for (const line of withLines.lines) {
      if (line.accountId !== accountId) continue;
      rows.push({
        entryId: entry.id,
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate,
        memo: entry.memo,
        direction: line.direction,
        amount: line.amount,
        caseId: line.caseId,
      });
    }
  }
  rows.sort((a, b) => (a.entryDate < b.entryDate ? -1 : 1));

  const endingBalance = await getAccountBalance(organizationId, accountId, dataAdapterMode, options?.toDate);
  return { account, rows, endingBalance };
}

export type BalanceSheetLine = { accountId: string; accountNumber: string; accountName: string; amount: number };
export type BalanceSheetReport = {
  asOfDate: string | null;
  assets: BalanceSheetLine[];
  liabilities: BalanceSheetLine[];
  equity: BalanceSheetLine[];
  netIncome: number;
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
};

/**
 * Folds Net Income (Revenue − Expense, all-time or through `asOfDate`)
 * into Equity as a synthetic line, since this phase has no formal
 * period-close/closing-entries feature yet (a disclosed, deferred
 * simplification — see ADR-035's own Deferred section).
 */
export async function getBalanceSheet(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
  asOfDate?: string,
): Promise<BalanceSheetReport> {
  const accounts = await listAccounts(organizationId, dataAdapterMode);

  const lineFor = async (account: LedgerAccount): Promise<BalanceSheetLine> => {
    const raw = await getAccountBalance(organizationId, account.id, dataAdapterMode, asOfDate);
    return { accountId: account.id, accountNumber: account.accountNumber, accountName: account.name, amount: displayAmount(account.accountType, raw) };
  };

  const assets = await Promise.all(accounts.filter((a) => a.accountType === 'asset').map(lineFor));
  const liabilities = await Promise.all(accounts.filter((a) => a.accountType === 'liability').map(lineFor));
  const equity = await Promise.all(accounts.filter((a) => a.accountType === 'equity').map(lineFor));
  const revenue = await Promise.all(accounts.filter((a) => a.accountType === 'revenue').map(lineFor));
  const expense = await Promise.all(accounts.filter((a) => a.accountType === 'expense').map(lineFor));

  const totalRevenue = revenue.reduce((sum, l) => sum + l.amount, 0);
  const totalExpense = expense.reduce((sum, l) => sum + l.amount, 0);
  const netIncome = totalRevenue - totalExpense;

  const sortByNumber = (a: BalanceSheetLine, b: BalanceSheetLine) => (a.accountNumber < b.accountNumber ? -1 : 1);
  const totalAssets = assets.reduce((sum, l) => sum + l.amount, 0);
  const totalLiabilitiesAndEquity = liabilities.reduce((sum, l) => sum + l.amount, 0) + equity.reduce((sum, l) => sum + l.amount, 0) + netIncome;

  return {
    asOfDate: asOfDate ?? null,
    assets: assets.sort(sortByNumber),
    liabilities: liabilities.sort(sortByNumber),
    equity: equity.sort(sortByNumber),
    netIncome,
    totalAssets,
    totalLiabilitiesAndEquity,
  };
}

export type ProfitAndLossReport = {
  fromDate: string | null;
  toDate: string | null;
  revenue: BalanceSheetLine[];
  expenses: BalanceSheetLine[];
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
};

/**
 * Revenue/Expense activity strictly within `[fromDate, toDate]` — unlike
 * the Balance Sheet's all-time-through-`asOfDate` accounts,
 * `getAccountBalance` has no lower-bound date filter of its own, so this
 * sums each in-range posted entry's own lines directly rather than
 * reusing it.
 */
export async function getProfitAndLoss(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
  options?: { fromDate?: string; toDate?: string },
): Promise<ProfitAndLossReport> {
  const accounts = await accountMap(organizationId, dataAdapterMode);
  const relevantAccountIds = new Set(
    [...accounts.values()].filter((a) => a.accountType === 'revenue' || a.accountType === 'expense').map((a) => a.id),
  );

  const entries = (await listJournalEntriesForOrganization(organizationId, dataAdapterMode, options)).filter((e) => e.status === 'posted');
  const rawTotals = new Map<string, number>(); // accountId -> debit-positive raw sum

  for (const entry of entries) {
    const withLines = await getJournalEntryWithLines(organizationId, entry.id, dataAdapterMode);
    if (!withLines) continue;
    for (const line of withLines.lines) {
      if (!relevantAccountIds.has(line.accountId)) continue;
      const delta = line.direction === 'debit' ? line.amount : -line.amount;
      rawTotals.set(line.accountId, (rawTotals.get(line.accountId) ?? 0) + delta);
    }
  }

  const toLine = (accountId: string, raw: number): BalanceSheetLine => {
    const account = accounts.get(accountId)!;
    return { accountId, accountNumber: account.accountNumber, accountName: account.name, amount: displayAmount(account.accountType, raw) };
  };

  const revenue: BalanceSheetLine[] = [];
  const expenses: BalanceSheetLine[] = [];
  for (const [accountId, raw] of rawTotals.entries()) {
    const account = accounts.get(accountId);
    if (!account) continue;
    if (account.accountType === 'revenue') revenue.push(toLine(accountId, raw));
    else expenses.push(toLine(accountId, raw));
  }
  const sortByNumber = (a: BalanceSheetLine, b: BalanceSheetLine) => (a.accountNumber < b.accountNumber ? -1 : 1);

  const totalRevenue = revenue.reduce((sum, l) => sum + l.amount, 0);
  const totalExpenses = expenses.reduce((sum, l) => sum + l.amount, 0);

  return {
    fromDate: options?.fromDate ?? null,
    toDate: options?.toDate ?? null,
    revenue: revenue.sort(sortByNumber),
    expenses: expenses.sort(sortByNumber),
    totalRevenue,
    totalExpenses,
    netIncome: totalRevenue - totalExpenses,
  };
}

export type ArAgingRow = {
  caseId: string;
  caseOrderId: string;
  balanceDue: number;
  anchorDate: string;
  ageDays: number;
  bucket: ArAgingBucket;
};

/**
 * Every open `CaseOrder` org-wide with `balanceDue > 0`, bucketed by age
 * from each case's own v1 `CaseOrder`'s `createdAt` — never the current
 * (possibly-superseded) version's own date, so a routine price edit never
 * resets an overdue balance's age to zero (see
 * domain/ledger/agingBuckets.ts's own comment). `reconciles` cross-checks
 * the sum against the GL's own derived Accounts Receivable balance —
 * never unified into one figure (conflict #2 in ADR-035).
 */
export async function getArAgingReport(
  organizationId: string,
  accountsReceivableLedgerAccountId: string,
  dataAdapterMode: DataAdapterMode,
  asOfDate?: string,
): Promise<{ rows: ArAgingRow[]; totalOutstanding: number; glAccountsReceivableBalance: number; reconciles: boolean }> {
  const now = asOfDate ?? new Date().toISOString();
  const openOrders = (await listActiveCaseOrdersForOrganization(organizationId, dataAdapterMode)).filter((o) => o.balanceDue > 0);

  const rows: ArAgingRow[] = [];
  for (const order of openOrders) {
    const versions = await listCaseOrderVersions(organizationId, order.caseId, dataAdapterMode);
    const v1 = versions.find((v) => v.version === 1);
    const anchorDate = v1?.createdAt ?? order.createdAt;
    const ageDays = Math.max(0, Math.floor((new Date(now).getTime() - new Date(anchorDate).getTime()) / (24 * 60 * 60 * 1000)));
    rows.push({
      caseId: order.caseId,
      caseOrderId: order.id,
      balanceDue: order.balanceDue,
      anchorDate,
      ageDays,
      bucket: bucketForAging(anchorDate, now),
    });
  }
  rows.sort((a, b) => b.ageDays - a.ageDays);

  const totalOutstanding = rows.reduce((sum, r) => sum + r.balanceDue, 0);
  const glAccountsReceivableBalance = await getAccountBalance(organizationId, accountsReceivableLedgerAccountId, dataAdapterMode, asOfDate);

  return { rows, totalOutstanding, glAccountsReceivableBalance, reconciles: totalOutstanding === glAccountsReceivableBalance };
}

export type TransactionRegisterRow = {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  sourceType: JournalEntry['sourceType'];
  memo: string;
  caseId: string | null;
  totalAmount: number;
  /** Best-effort enrichment from the originating record — null when
      there's nothing to resolve (e.g. a manual or reversal entry) or the
      referenced record no longer exists. */
  relatedDescription: string | null;
};

/**
 * Every posted `JournalEntry` header in a date range, enriched with a
 * human-readable description resolved from its originating
 * `PaymentRecord`/`BankDeposit` where one exists — a transaction-level
 * audit view, not a per-line one (see `getGeneralLedgerDetail` for that).
 */
export async function getTransactionRegister(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
  options?: { fromDate?: string; toDate?: string },
): Promise<TransactionRegisterRow[]> {
  const entries = (await listJournalEntriesForOrganization(organizationId, dataAdapterMode, options)).filter((e) => e.status === 'posted');

  const rows: TransactionRegisterRow[] = [];
  for (const entry of entries) {
    const withLines = await getJournalEntryWithLines(organizationId, entry.id, dataAdapterMode);
    const totalAmount = withLines ? withLines.lines.filter((l) => l.direction === 'debit').reduce((sum, l) => sum + l.amount, 0) : 0;

    let relatedDescription: string | null = null;
    if ((entry.sourceType === 'payment' || entry.sourceType === 'refund') && entry.sourceReferenceId) {
      const payment = await getPaymentRecordById(organizationId, entry.sourceReferenceId, dataAdapterMode);
      relatedDescription = payment ? payment.purpose : null;
    } else if (entry.sourceType === 'deposit' && entry.sourceReferenceId) {
      const deposit = await getBankDepositById(organizationId, entry.sourceReferenceId, dataAdapterMode);
      relatedDescription = deposit ? `Deposit of ${deposit.includedPaymentRecordIds.length} payment(s)` : null;
    }

    rows.push({
      entryId: entry.id,
      entryNumber: entry.entryNumber,
      entryDate: entry.entryDate,
      sourceType: entry.sourceType,
      memo: entry.memo,
      caseId: entry.caseId,
      totalAmount,
      relatedDescription,
    });
  }
  return rows.sort((a, b) => (a.entryDate < b.entryDate ? 1 : -1));
}
