import type { BankDeposit } from '../types/bankDeposit';

/**
 * Phase 31 (Financial Management & General Ledger). The one place a raw
 * Wix `bankDeposits` item is ever touched. Write-once — a deposit is
 * never edited or deleted after posting, mirroring every other financial
 * record this phase introduces.
 */
export type WixBankDepositItem = {
  beaconBankDepositId?: unknown;
  organizationId?: unknown;
  bankAccountId?: unknown;
  depositDate?: unknown;
  totalAmount?: unknown;
  includedPaymentRecordIds?: unknown;
  journalEntryId?: unknown;
  memo?: unknown;
  createdAt?: unknown;
  createdByStaffProfileId?: unknown;
};

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function mapWixBankDepositItem(item: WixBankDepositItem | undefined): BankDeposit | null {
  if (
    !item ||
    typeof item.beaconBankDepositId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.bankAccountId !== 'string' ||
    typeof item.depositDate !== 'string' ||
    typeof item.totalAmount !== 'number' ||
    !isStringArray(item.includedPaymentRecordIds) ||
    typeof item.journalEntryId !== 'string' ||
    !isStringOrNull(item.memo) ||
    typeof item.createdAt !== 'string' ||
    !isStringOrNull(item.createdByStaffProfileId)
  ) {
    return null;
  }

  return {
    id: item.beaconBankDepositId,
    organizationId: item.organizationId,
    bankAccountId: item.bankAccountId,
    depositDate: item.depositDate,
    totalAmount: item.totalAmount,
    includedPaymentRecordIds: item.includedPaymentRecordIds,
    journalEntryId: item.journalEntryId,
    memo: item.memo,
    createdAt: item.createdAt,
    createdByStaffProfileId: item.createdByStaffProfileId,
  };
}

export function buildWixBankDepositData(deposit: BankDeposit): WixBankDepositItem {
  return {
    beaconBankDepositId: deposit.id,
    organizationId: deposit.organizationId,
    bankAccountId: deposit.bankAccountId,
    depositDate: deposit.depositDate,
    totalAmount: deposit.totalAmount,
    includedPaymentRecordIds: deposit.includedPaymentRecordIds,
    journalEntryId: deposit.journalEntryId,
    memo: deposit.memo,
    createdAt: deposit.createdAt,
    createdByStaffProfileId: deposit.createdByStaffProfileId,
  };
}
