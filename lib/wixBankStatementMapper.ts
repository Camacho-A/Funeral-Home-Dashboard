import type { BankStatementImport, BankStatementLine, BankStatementLineMatchStatus } from '../types/bankStatement';

/**
 * Phase 31 (Financial Management & General Ledger). The one place a raw
 * Wix `bankStatementImports`/`bankStatementLines` item is ever touched —
 * both collections share this file since they're always read/written
 * together by services/bankingService.ts, mirroring how
 * lib/wixCaseOrderMapper.ts and lib/wixCaseOrderLineItemMapper.ts are kept
 * as two separate files only because CaseOrder itself is mutable and line
 * items aren't; here neither import record nor its lines are ever mutated
 * except `BankStatementLine.matchStatus`/`matchedJournalEntryId` (the
 * matching workflow), so a single file matches this pairing's own shape.
 */
export type WixBankStatementImportItem = {
  beaconBankStatementImportId?: unknown;
  organizationId?: unknown;
  bankAccountId?: unknown;
  importedAt?: unknown;
  fileName?: unknown;
  statementPeriodStart?: unknown;
  statementPeriodEnd?: unknown;
  lineCount?: unknown;
  createdByStaffProfileId?: unknown;
};

export type WixBankStatementLineItem = {
  beaconBankStatementLineId?: unknown;
  organizationId?: unknown;
  bankStatementImportId?: unknown;
  bankAccountId?: unknown;
  transactionDate?: unknown;
  description?: unknown;
  amount?: unknown;
  matchedJournalEntryId?: unknown;
  matchStatus?: unknown;
  createdAt?: unknown;
};

const VALID_MATCH_STATUSES: readonly string[] = ['unmatched', 'auto_matched', 'manually_matched', 'excluded'];

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isMatchStatus(value: unknown): value is BankStatementLineMatchStatus {
  return typeof value === 'string' && VALID_MATCH_STATUSES.includes(value);
}

export function mapWixBankStatementImportItem(
  item: WixBankStatementImportItem | undefined,
): BankStatementImport | null {
  if (
    !item ||
    typeof item.beaconBankStatementImportId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.bankAccountId !== 'string' ||
    typeof item.importedAt !== 'string' ||
    !isStringOrNull(item.fileName) ||
    !isStringOrNull(item.statementPeriodStart) ||
    !isStringOrNull(item.statementPeriodEnd) ||
    typeof item.lineCount !== 'number' ||
    !isStringOrNull(item.createdByStaffProfileId)
  ) {
    return null;
  }

  return {
    id: item.beaconBankStatementImportId,
    organizationId: item.organizationId,
    bankAccountId: item.bankAccountId,
    importedAt: item.importedAt,
    fileName: item.fileName,
    statementPeriodStart: item.statementPeriodStart,
    statementPeriodEnd: item.statementPeriodEnd,
    lineCount: item.lineCount,
    createdByStaffProfileId: item.createdByStaffProfileId,
  };
}

export function buildWixBankStatementImportData(record: BankStatementImport): WixBankStatementImportItem {
  return {
    beaconBankStatementImportId: record.id,
    organizationId: record.organizationId,
    bankAccountId: record.bankAccountId,
    importedAt: record.importedAt,
    fileName: record.fileName,
    statementPeriodStart: record.statementPeriodStart,
    statementPeriodEnd: record.statementPeriodEnd,
    lineCount: record.lineCount,
    createdByStaffProfileId: record.createdByStaffProfileId,
  };
}

export function mapWixBankStatementLineItem(item: WixBankStatementLineItem | undefined): BankStatementLine | null {
  if (
    !item ||
    typeof item.beaconBankStatementLineId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.bankStatementImportId !== 'string' ||
    typeof item.bankAccountId !== 'string' ||
    typeof item.transactionDate !== 'string' ||
    typeof item.description !== 'string' ||
    typeof item.amount !== 'number' ||
    !isStringOrNull(item.matchedJournalEntryId) ||
    !isMatchStatus(item.matchStatus) ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconBankStatementLineId,
    organizationId: item.organizationId,
    bankStatementImportId: item.bankStatementImportId,
    bankAccountId: item.bankAccountId,
    transactionDate: item.transactionDate,
    description: item.description,
    amount: item.amount,
    matchedJournalEntryId: item.matchedJournalEntryId,
    matchStatus: item.matchStatus,
    createdAt: item.createdAt,
  };
}

export function buildWixBankStatementLineData(line: BankStatementLine): WixBankStatementLineItem {
  return {
    beaconBankStatementLineId: line.id,
    organizationId: line.organizationId,
    bankStatementImportId: line.bankStatementImportId,
    bankAccountId: line.bankAccountId,
    transactionDate: line.transactionDate,
    description: line.description,
    amount: line.amount,
    matchedJournalEntryId: line.matchedJournalEntryId,
    matchStatus: line.matchStatus,
    createdAt: line.createdAt,
  };
}

/** `matchedJournalEntryId`/`matchStatus` are the only fields the matching
    workflow (auto-match, manual match, exclude) ever changes on an
    existing line. */
export function applyBankStatementLineUpdateToWixData(
  existing: WixBankStatementLineItem,
  patch: Partial<Pick<BankStatementLine, 'matchedJournalEntryId' | 'matchStatus'>>,
): WixBankStatementLineItem {
  return { ...existing, ...patch };
}
