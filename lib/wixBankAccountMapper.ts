import type { BankAccount } from '../types/bankAccount';

/**
 * Phase 31 (Financial Management & General Ledger). The one place a raw
 * Wix `bankAccounts` item is ever touched. `beaconBankAccountId` is set
 * as the item's own system `_id` at insert time.
 */
export type WixBankAccountItem = {
  beaconBankAccountId?: unknown;
  organizationId?: unknown;
  name?: unknown;
  ledgerAccountId?: unknown;
  accountNumberLast4?: unknown;
  bankName?: unknown;
  isActive?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixBankAccountItem(item: WixBankAccountItem | undefined): BankAccount | null {
  if (
    !item ||
    typeof item.beaconBankAccountId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.ledgerAccountId !== 'string' ||
    !isStringOrNull(item.accountNumberLast4) ||
    !isStringOrNull(item.bankName) ||
    typeof item.isActive !== 'boolean' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconBankAccountId,
    organizationId: item.organizationId,
    name: item.name,
    ledgerAccountId: item.ledgerAccountId,
    accountNumberLast4: item.accountNumberLast4,
    bankName: item.bankName,
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixBankAccountData(account: BankAccount): WixBankAccountItem {
  return {
    beaconBankAccountId: account.id,
    organizationId: account.organizationId,
    name: account.name,
    ledgerAccountId: account.ledgerAccountId,
    accountNumberLast4: account.accountNumberLast4,
    bankName: account.bankName,
    isActive: account.isActive,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

/** The only fields `bankingService.ts`'s update paths ever change — a
    `BankAccount` is never hard-deleted, only deactivated. */
export function applyBankAccountUpdateToWixData(
  existing: WixBankAccountItem,
  patch: Partial<Pick<BankAccount, 'name' | 'accountNumberLast4' | 'bankName' | 'isActive' | 'updatedAt'>>,
): WixBankAccountItem {
  return { ...existing, ...patch };
}
