import type { BankReconciliation, BankReconciliationStatus } from '../types/bankReconciliation';

/**
 * Phase 31 (Financial Management & General Ledger). The one place a raw
 * Wix `bankReconciliations` item is ever touched.
 */
export type WixBankReconciliationItem = {
  beaconBankReconciliationId?: unknown;
  organizationId?: unknown;
  bankAccountId?: unknown;
  statementEndingDate?: unknown;
  statementEndingBalance?: unknown;
  bookBalanceAtStart?: unknown;
  status?: unknown;
  bankStatementImportId?: unknown;
  completedAt?: unknown;
  completedByStaffProfileId?: unknown;
  createdAt?: unknown;
};

const VALID_STATUSES: readonly string[] = ['in_progress', 'completed'];

function isStatus(value: unknown): value is BankReconciliationStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixBankReconciliationItem(
  item: WixBankReconciliationItem | undefined,
): BankReconciliation | null {
  if (
    !item ||
    typeof item.beaconBankReconciliationId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.bankAccountId !== 'string' ||
    typeof item.statementEndingDate !== 'string' ||
    typeof item.statementEndingBalance !== 'number' ||
    typeof item.bookBalanceAtStart !== 'number' ||
    !isStatus(item.status) ||
    !isStringOrNull(item.bankStatementImportId) ||
    !isStringOrNull(item.completedAt) ||
    !isStringOrNull(item.completedByStaffProfileId) ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconBankReconciliationId,
    organizationId: item.organizationId,
    bankAccountId: item.bankAccountId,
    statementEndingDate: item.statementEndingDate,
    statementEndingBalance: item.statementEndingBalance,
    bookBalanceAtStart: item.bookBalanceAtStart,
    status: item.status,
    bankStatementImportId: item.bankStatementImportId,
    completedAt: item.completedAt,
    completedByStaffProfileId: item.completedByStaffProfileId,
    createdAt: item.createdAt,
  };
}

export function buildWixBankReconciliationData(reconciliation: BankReconciliation): WixBankReconciliationItem {
  return {
    beaconBankReconciliationId: reconciliation.id,
    organizationId: reconciliation.organizationId,
    bankAccountId: reconciliation.bankAccountId,
    statementEndingDate: reconciliation.statementEndingDate,
    statementEndingBalance: reconciliation.statementEndingBalance,
    bookBalanceAtStart: reconciliation.bookBalanceAtStart,
    status: reconciliation.status,
    bankStatementImportId: reconciliation.bankStatementImportId,
    completedAt: reconciliation.completedAt,
    completedByStaffProfileId: reconciliation.completedByStaffProfileId,
    createdAt: reconciliation.createdAt,
  };
}

/** `status`/`completedAt`/`completedByStaffProfileId` are the only fields
    `bankingService.ts`'s `completeReconciliation` ever changes. */
export function applyBankReconciliationUpdateToWixData(
  existing: WixBankReconciliationItem,
  patch: Partial<Pick<BankReconciliation, 'status' | 'completedAt' | 'completedByStaffProfileId'>>,
): WixBankReconciliationItem {
  return { ...existing, ...patch };
}
