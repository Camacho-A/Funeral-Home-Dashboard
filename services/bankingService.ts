import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import { mapWixBankAccountItem, buildWixBankAccountData, applyBankAccountUpdateToWixData, type WixBankAccountItem } from '../lib/wixBankAccountMapper';
import {
  buildWixBankStatementImportData,
  mapWixBankStatementLineItem,
  buildWixBankStatementLineData,
  applyBankStatementLineUpdateToWixData,
  type WixBankStatementImportItem,
  type WixBankStatementLineItem,
} from '../lib/wixBankStatementMapper';
import {
  mapWixBankReconciliationItem,
  buildWixBankReconciliationData,
  applyBankReconciliationUpdateToWixData,
  type WixBankReconciliationItem,
} from '../lib/wixBankReconciliationMapper';
import type { BankAccount } from '../types/bankAccount';
import type { BankStatementImport, BankStatementLine } from '../types/bankStatement';
import type { BankReconciliation } from '../types/bankReconciliation';
import { getAccountById } from './chartOfAccountsService';
import { getAccountBalance, listAllLinesForAccount, listJournalEntriesForOrganization } from './generalLedgerService';
import type { ActivityContext } from './activityService';
import { recordBankStatementImported, recordBankReconciliationStarted, recordBankReconciliationCompleted } from './activityService';
import {
  bankAccountFixtures,
  bankStatementImportFixtures,
  bankStatementLineFixtures,
  bankReconciliationFixtures,
} from './__mocks__/bankingFixtures';

/**
 * Phase 31 (Financial Management & General Ledger). Owns the
 * `bankAccounts`/`bankStatementImports`/`bankStatementLines`/
 * `bankReconciliations` collections exclusively — see
 * docs/adr/ADR-035-financial-management-and-general-ledger.md. Deposit
 * *creation* (Dr Cash-Bank / Cr Undeposited Funds, the `BankDeposit` row
 * itself) lives in `services/financialTransactionService.ts#postDepositTransaction`
 * instead — that function already owns the one journal-entry-posting path
 * every financial transaction type goes through, and a deposit is exactly
 * that: a transaction. This file is account management, statement import,
 * matching, and reconciliation only.
 *
 * No caching, mirroring every other service this phase — every resolution
 * here is a fresh read, every call.
 */
export class BankingServiceError extends Error {}

function nowIso(): string {
  return new Date().toISOString();
}

function daysBetween(dateA: string, dateB: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.abs(Math.round((new Date(dateA).getTime() - new Date(dateB).getTime()) / msPerDay));
}

export async function getBankAccountById(
  organizationId: string,
  bankAccountId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<BankAccount | null> {
  if (dataAdapterMode === 'mock') {
    return bankAccountFixtures.find((a) => a.id === bankAccountId && a.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixBankAccountItem>('bankAccounts', {
    filter: { organizationId, beaconBankAccountId: bankAccountId },
    paging: { limit: 1 },
  });
  return mapWixBankAccountItem(response.dataItems[0]?.data);
}

export async function listBankAccounts(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<BankAccount[]> {
  if (dataAdapterMode === 'mock') {
    return bankAccountFixtures.filter((a) => a.organizationId === organizationId);
  }
  const response = await queryWixDataItems<WixBankAccountItem>('bankAccounts', { filter: { organizationId } });
  return response.dataItems.map((item) => mapWixBankAccountItem(item.data)).filter((a): a is BankAccount => a !== null);
}

/**
 * `ledgerAccountId` must reference an existing asset-type `LedgerAccount`
 * — a `BankAccount`'s real balance is always that account's derived
 * `getAccountBalance`, never a value stored here.
 */
export async function createBankAccount(
  organizationId: string,
  params: {
    name: string;
    ledgerAccountId: string;
    accountNumberLast4?: string | null;
    bankName?: string | null;
    idFactory: () => string;
    now?: string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<BankAccount> {
  const ledgerAccount = await getAccountById(organizationId, params.ledgerAccountId, dataAdapterMode);
  if (!ledgerAccount) {
    throw new BankingServiceError(`No ledger account "${params.ledgerAccountId}" exists in this organization.`);
  }
  if (ledgerAccount.accountType !== 'asset') {
    throw new BankingServiceError('A bank account must link to an asset-type ledger account.');
  }

  const now = params.now ?? nowIso();
  const account: BankAccount = {
    id: params.idFactory(),
    organizationId,
    name: params.name,
    ledgerAccountId: params.ledgerAccountId,
    accountNumberLast4: params.accountNumberLast4 ?? null,
    bankName: params.bankName ?? null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  if (dataAdapterMode === 'mock') {
    bankAccountFixtures.push(account);
    return account;
  }
  await insertWixDataItem<WixBankAccountItem>('bankAccounts', buildWixBankAccountData(account), account.id);
  return account;
}

/** The only other lifecycle transition — a `BankAccount` is never
    hard-deleted, so historical deposits/reconciliations remain
    attributable to it forever. */
export async function deactivateBankAccount(
  organizationId: string,
  bankAccountId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<BankAccount> {
  const account = await getBankAccountById(organizationId, bankAccountId, dataAdapterMode);
  if (!account) throw new BankingServiceError(`No bank account "${bankAccountId}" exists in this organization.`);

  const now = nowIso();
  if (dataAdapterMode === 'mock') {
    const index = bankAccountFixtures.findIndex((a) => a.id === bankAccountId && a.organizationId === organizationId);
    bankAccountFixtures[index] = { ...bankAccountFixtures[index], isActive: false, updatedAt: now };
    return bankAccountFixtures[index];
  }
  const response = await queryWixDataItems<WixBankAccountItem>('bankAccounts', {
    filter: { organizationId, beaconBankAccountId: bankAccountId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new BankingServiceError(`No bank account "${bankAccountId}" exists in this organization.`);
  const merged = applyBankAccountUpdateToWixData(existingItem.data, { isActive: false, updatedAt: now });
  const updated = await updateWixDataItem<WixBankAccountItem>('bankAccounts', existingItem.id, merged);
  const mapped = mapWixBankAccountItem(updated.data);
  if (!mapped) throw new BankingServiceError('Failed to deactivate bank account.');
  return mapped;
}

/** A `BankAccount`'s real, current balance — never a value stored on the
    row itself, always freshly derived from the linked `LedgerAccount`'s
    posted journal lines. */
export async function getBankAccountDerivedBalance(
  organizationId: string,
  bankAccountId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<number> {
  const account = await getBankAccountById(organizationId, bankAccountId, dataAdapterMode);
  if (!account) throw new BankingServiceError(`No bank account "${bankAccountId}" exists in this organization.`);
  return getAccountBalance(organizationId, account.ledgerAccountId, dataAdapterMode);
}

async function insertBankStatementImportRow(record: BankStatementImport, dataAdapterMode: DataAdapterMode): Promise<BankStatementImport> {
  if (dataAdapterMode === 'mock') {
    bankStatementImportFixtures.push(record);
    return record;
  }
  await insertWixDataItem<WixBankStatementImportItem>('bankStatementImports', buildWixBankStatementImportData(record), record.id);
  return record;
}

async function insertBankStatementLineRows(lines: BankStatementLine[], dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    bankStatementLineFixtures.push(...lines);
    return;
  }
  for (const line of lines) {
    await insertWixDataItem<WixBankStatementLineItem>('bankStatementLines', buildWixBankStatementLineData(line), line.id);
  }
}

export async function getStatementLinesForImport(
  organizationId: string,
  bankStatementImportId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<BankStatementLine[]> {
  if (dataAdapterMode === 'mock') {
    return bankStatementLineFixtures.filter((l) => l.organizationId === organizationId && l.bankStatementImportId === bankStatementImportId);
  }
  const response = await queryWixDataItems<WixBankStatementLineItem>('bankStatementLines', { filter: { organizationId, bankStatementImportId } });
  return response.dataItems.map((item) => mapWixBankStatementLineItem(item.data)).filter((l): l is BankStatementLine => l !== null);
}

export async function getStatementLinesForBankAccount(
  organizationId: string,
  bankAccountId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<BankStatementLine[]> {
  if (dataAdapterMode === 'mock') {
    return bankStatementLineFixtures.filter((l) => l.organizationId === organizationId && l.bankAccountId === bankAccountId);
  }
  const response = await queryWixDataItems<WixBankStatementLineItem>('bankStatementLines', { filter: { organizationId, bankAccountId } });
  return response.dataItems.map((item) => mapWixBankStatementLineItem(item.data)).filter((l): l is BankStatementLine => l !== null);
}

async function getStatementLineById(organizationId: string, lineId: string, dataAdapterMode: DataAdapterMode): Promise<BankStatementLine | null> {
  if (dataAdapterMode === 'mock') {
    return bankStatementLineFixtures.find((l) => l.id === lineId && l.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixBankStatementLineItem>('bankStatementLines', {
    filter: { organizationId, beaconBankStatementLineId: lineId },
    paging: { limit: 1 },
  });
  return mapWixBankStatementLineItem(response.dataItems[0]?.data);
}

async function updateStatementLineMatch(
  organizationId: string,
  lineId: string,
  patch: Partial<Pick<BankStatementLine, 'matchedJournalEntryId' | 'matchStatus'>>,
  dataAdapterMode: DataAdapterMode,
): Promise<BankStatementLine | null> {
  if (dataAdapterMode === 'mock') {
    const index = bankStatementLineFixtures.findIndex((l) => l.id === lineId && l.organizationId === organizationId);
    if (index === -1) return null;
    bankStatementLineFixtures[index] = { ...bankStatementLineFixtures[index], ...patch };
    return bankStatementLineFixtures[index];
  }
  const response = await queryWixDataItems<WixBankStatementLineItem>('bankStatementLines', {
    filter: { organizationId, beaconBankStatementLineId: lineId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return null;
  const merged = applyBankStatementLineUpdateToWixData(existingItem.data, patch);
  const updated = await updateWixDataItem<WixBankStatementLineItem>('bankStatementLines', existingItem.id, merged);
  return mapWixBankStatementLineItem(updated.data);
}

/**
 * Imports one bank statement's raw lines (already parsed by the caller —
 * this function does no file-format parsing itself) as `unmatched`
 * `BankStatementLine`s, ready for `runAutoMatch`.
 */
export async function importBankStatement(
  organizationId: string,
  params: {
    bankAccountId: string;
    fileName: string | null;
    statementPeriodStart: string | null;
    statementPeriodEnd: string | null;
    lines: Array<{ transactionDate: string; description: string; amount: number }>;
    createdByStaffProfileId: string | null;
    idFactory: () => string;
    now?: string;
  },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<{ statementImport: BankStatementImport; lines: BankStatementLine[] }> {
  const bankAccount = await getBankAccountById(organizationId, params.bankAccountId, dataAdapterMode);
  if (!bankAccount) throw new BankingServiceError(`No bank account "${params.bankAccountId}" exists in this organization.`);

  const now = params.now ?? nowIso();
  const statementImport: BankStatementImport = {
    id: params.idFactory(),
    organizationId,
    bankAccountId: params.bankAccountId,
    importedAt: now,
    fileName: params.fileName,
    statementPeriodStart: params.statementPeriodStart,
    statementPeriodEnd: params.statementPeriodEnd,
    lineCount: params.lines.length,
    createdByStaffProfileId: params.createdByStaffProfileId,
  };
  const insertedImport = await insertBankStatementImportRow(statementImport, dataAdapterMode);

  const lines: BankStatementLine[] = params.lines.map((line) => ({
    id: params.idFactory(),
    organizationId,
    bankStatementImportId: insertedImport.id,
    bankAccountId: params.bankAccountId,
    transactionDate: line.transactionDate,
    description: line.description,
    amount: line.amount,
    matchedJournalEntryId: null,
    matchStatus: 'unmatched',
    createdAt: now,
  }));
  await insertBankStatementLineRows(lines, dataAdapterMode);

  await recordBankStatementImported(ctx, insertedImport.id, lines.length, dataAdapterMode);
  return { statementImport: insertedImport, lines };
}

/**
 * For every `unmatched` line against this bank account: candidates are
 * `JournalEntryLine`s posted against the account's linked `LedgerAccount`
 * where direction/amount match exactly (a positive statement amount is a
 * deposit → a debit line; negative is a withdrawal → a credit line) and
 * the parent entry's `entryDate` is within ±3 days, excluding any
 * `JournalEntry` already matched to another line for this account.
 * Exactly one candidate auto-matches; zero or multiple are left
 * `unmatched` for a human (`manuallyMatchStatementLine`/
 * `excludeStatementLine`). See types/bankStatement.ts's own comment.
 */
export async function runAutoMatch(
  organizationId: string,
  bankAccountId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ matchedCount: number; lines: BankStatementLine[] }> {
  const bankAccount = await getBankAccountById(organizationId, bankAccountId, dataAdapterMode);
  if (!bankAccount) throw new BankingServiceError(`No bank account "${bankAccountId}" exists in this organization.`);

  const statementLines = await getStatementLinesForBankAccount(organizationId, bankAccountId, dataAdapterMode);
  const alreadyMatchedEntryIds = new Set(
    statementLines.filter((l) => l.matchedJournalEntryId).map((l) => l.matchedJournalEntryId as string),
  );

  const ledgerLines = await listAllLinesForAccount(organizationId, bankAccount.ledgerAccountId, dataAdapterMode);
  const entries = await listJournalEntriesForOrganization(organizationId, dataAdapterMode);
  const postedEntryById = new Map(entries.filter((e) => e.status === 'posted').map((e) => [e.id, e]));

  let matchedCount = 0;
  for (const statementLine of statementLines) {
    if (statementLine.matchStatus !== 'unmatched') continue;

    const wantDirection = statementLine.amount > 0 ? 'debit' : 'credit';
    const wantAmount = Math.abs(statementLine.amount);
    const candidates = ledgerLines.filter((line) => {
      if (line.direction !== wantDirection || line.amount !== wantAmount) return false;
      if (alreadyMatchedEntryIds.has(line.journalEntryId)) return false;
      const entry = postedEntryById.get(line.journalEntryId);
      if (!entry) return false;
      return daysBetween(entry.entryDate, statementLine.transactionDate) <= 3;
    });

    if (candidates.length === 1) {
      const updated = await updateStatementLineMatch(
        organizationId,
        statementLine.id,
        { matchStatus: 'auto_matched', matchedJournalEntryId: candidates[0].journalEntryId },
        dataAdapterMode,
      );
      if (updated) {
        alreadyMatchedEntryIds.add(candidates[0].journalEntryId);
        matchedCount += 1;
      }
    }
  }

  return { matchedCount, lines: await getStatementLinesForBankAccount(organizationId, bankAccountId, dataAdapterMode) };
}

export async function manuallyMatchStatementLine(
  organizationId: string,
  lineId: string,
  journalEntryId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<BankStatementLine> {
  const line = await getStatementLineById(organizationId, lineId, dataAdapterMode);
  if (!line) throw new BankingServiceError(`No bank statement line "${lineId}" exists in this organization.`);

  const updated = await updateStatementLineMatch(
    organizationId,
    lineId,
    { matchStatus: 'manually_matched', matchedJournalEntryId: journalEntryId },
    dataAdapterMode,
  );
  if (!updated) throw new BankingServiceError('Failed to match bank statement line.');
  return updated;
}

/** For bank-only events with no corresponding Beacon-authored entry yet
    (e.g. a bank fee) — a named, disclosed gap: staff must separately post
    a manual adjustment before a reconciliation including this line can
    balance (see types/bankStatement.ts's own comment). */
export async function excludeStatementLine(
  organizationId: string,
  lineId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<BankStatementLine> {
  const line = await getStatementLineById(organizationId, lineId, dataAdapterMode);
  if (!line) throw new BankingServiceError(`No bank statement line "${lineId}" exists in this organization.`);

  const updated = await updateStatementLineMatch(organizationId, lineId, { matchStatus: 'excluded', matchedJournalEntryId: null }, dataAdapterMode);
  if (!updated) throw new BankingServiceError('Failed to exclude bank statement line.');
  return updated;
}

async function insertBankReconciliationRow(record: BankReconciliation, dataAdapterMode: DataAdapterMode): Promise<BankReconciliation> {
  if (dataAdapterMode === 'mock') {
    bankReconciliationFixtures.push(record);
    return record;
  }
  await insertWixDataItem<WixBankReconciliationItem>('bankReconciliations', buildWixBankReconciliationData(record), record.id);
  return record;
}

async function getReconciliationById(organizationId: string, reconciliationId: string, dataAdapterMode: DataAdapterMode): Promise<BankReconciliation | null> {
  if (dataAdapterMode === 'mock') {
    return bankReconciliationFixtures.find((r) => r.id === reconciliationId && r.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixBankReconciliationItem>('bankReconciliations', {
    filter: { organizationId, beaconBankReconciliationId: reconciliationId },
    paging: { limit: 1 },
  });
  return mapWixBankReconciliationItem(response.dataItems[0]?.data);
}

export async function listReconciliationHistory(
  organizationId: string,
  bankAccountId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<BankReconciliation[]> {
  if (dataAdapterMode === 'mock') {
    return bankReconciliationFixtures
      .filter((r) => r.organizationId === organizationId && r.bankAccountId === bankAccountId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  const response = await queryWixDataItems<WixBankReconciliationItem>('bankReconciliations', { filter: { organizationId, bankAccountId } });
  return response.dataItems
    .map((item) => mapWixBankReconciliationItem(item.data))
    .filter((r): r is BankReconciliation => r !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * `bookBalanceAtStart` is the last **completed** reconciliation's own
 * `statementEndingBalance` for this bank account (0 for the account's
 * first-ever reconciliation) — never the account's current derived
 * balance. Standard bank-reconciliation practice: this period's opening
 * book balance is by definition last period's confirmed closing balance,
 * since everything reconciled last time is already accounted for.
 * Snapshotting the *current* balance instead would double-count any
 * transaction posted (and already reflected in the live balance) before
 * this reconciliation started but which this same pass is also matching
 * against — see types/bankReconciliation.ts's own comment on why this
 * field is an audit-only snapshot, never recomputed or trusted as
 * authoritative afterward.
 */
export async function startReconciliation(
  organizationId: string,
  params: {
    bankAccountId: string;
    statementEndingDate: string;
    statementEndingBalance: number;
    bankStatementImportId?: string | null;
    idFactory: () => string;
    now?: string;
  },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<BankReconciliation> {
  const bankAccount = await getBankAccountById(organizationId, params.bankAccountId, dataAdapterMode);
  if (!bankAccount) throw new BankingServiceError(`No bank account "${params.bankAccountId}" exists in this organization.`);

  const now = params.now ?? nowIso();
  const priorHistory = await listReconciliationHistory(organizationId, params.bankAccountId, dataAdapterMode);
  const lastCompleted = priorHistory.find((r) => r.status === 'completed');
  const bookBalanceAtStart = lastCompleted ? lastCompleted.statementEndingBalance : 0;

  const reconciliation: BankReconciliation = {
    id: params.idFactory(),
    organizationId,
    bankAccountId: params.bankAccountId,
    statementEndingDate: params.statementEndingDate,
    statementEndingBalance: params.statementEndingBalance,
    bookBalanceAtStart,
    status: 'in_progress',
    bankStatementImportId: params.bankStatementImportId ?? null,
    completedAt: null,
    completedByStaffProfileId: null,
    createdAt: now,
  };
  const inserted = await insertBankReconciliationRow(reconciliation, dataAdapterMode);
  await recordBankReconciliationStarted(ctx, inserted.id, dataAdapterMode);
  return inserted;
}

/**
 * Validates `bookBalanceAtStart + sum(matched line amounts) === statementEndingBalance`
 * before completing — returns the variance instead of silently completing
 * when it doesn't balance (see types/bankReconciliation.ts's own
 * comment). "Matched" means `auto_matched` or `manually_matched` lines
 * belonging to this reconciliation's own `bankStatementImportId` —
 * `excluded` lines are deliberately never counted (see
 * `excludeStatementLine`'s own comment on why those still need a separate
 * manual adjustment before they'd balance).
 */
export async function completeReconciliation(
  organizationId: string,
  params: {
    reconciliationId: string;
    completedByStaffProfileId: string | null;
    now?: string;
  },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<{ reconciliation: BankReconciliation; variance: number; completed: boolean }> {
  const reconciliation = await getReconciliationById(organizationId, params.reconciliationId, dataAdapterMode);
  if (!reconciliation) throw new BankingServiceError(`No bank reconciliation "${params.reconciliationId}" exists in this organization.`);
  if (reconciliation.status === 'completed') {
    throw new BankingServiceError('This reconciliation has already been completed.');
  }

  const matchedLines = reconciliation.bankStatementImportId
    ? (await getStatementLinesForImport(organizationId, reconciliation.bankStatementImportId, dataAdapterMode)).filter(
        (l) => l.matchStatus === 'auto_matched' || l.matchStatus === 'manually_matched',
      )
    : [];
  const matchedTotal = matchedLines.reduce((sum, l) => sum + l.amount, 0);
  const variance = reconciliation.statementEndingBalance - (reconciliation.bookBalanceAtStart + matchedTotal);

  if (variance !== 0) {
    return { reconciliation, variance, completed: false };
  }

  const now = params.now ?? nowIso();
  let updated: BankReconciliation;
  if (dataAdapterMode === 'mock') {
    const index = bankReconciliationFixtures.findIndex((r) => r.id === reconciliation.id && r.organizationId === organizationId);
    bankReconciliationFixtures[index] = {
      ...bankReconciliationFixtures[index],
      status: 'completed',
      completedAt: now,
      completedByStaffProfileId: params.completedByStaffProfileId,
    };
    updated = bankReconciliationFixtures[index];
  } else {
    const response = await queryWixDataItems<WixBankReconciliationItem>('bankReconciliations', {
      filter: { organizationId, beaconBankReconciliationId: reconciliation.id },
      paging: { limit: 1 },
    });
    const existingItem = response.dataItems[0];
    if (!existingItem) throw new BankingServiceError('Failed to complete bank reconciliation.');
    const merged = applyBankReconciliationUpdateToWixData(existingItem.data, {
      status: 'completed',
      completedAt: now,
      completedByStaffProfileId: params.completedByStaffProfileId,
    });
    const updatedItem = await updateWixDataItem<WixBankReconciliationItem>('bankReconciliations', existingItem.id, merged);
    const mapped = mapWixBankReconciliationItem(updatedItem.data);
    if (!mapped) throw new BankingServiceError('Failed to complete bank reconciliation.');
    updated = mapped;
  }

  await recordBankReconciliationCompleted(ctx, updated.id, dataAdapterMode);
  return { reconciliation: updated, variance: 0, completed: true };
}
