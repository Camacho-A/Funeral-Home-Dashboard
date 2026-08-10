import type { LedgerAccount, LedgerAccountType, LedgerAccountNormalBalance } from '../types/ledgerAccount';

/**
 * Phase 31 (Financial Management & General Ledger). The one place a raw
 * Wix `chartOfAccounts` item is ever touched. `beaconLedgerAccountId` is
 * set as the item's own system `_id` at insert time (the established
 * `cases`/`beaconCaseId` trick), so no separate unique-index field is
 * spent on it — `accountNumber` uniqueness is instead enforced via a
 * composed `{organizationId}:{accountNumber}` value on a dedicated field,
 * the same technique `paymentRecords.idempotencyKey` already uses.
 */
export type WixLedgerAccountItem = {
  beaconLedgerAccountId?: unknown;
  organizationId?: unknown;
  accountNumber?: unknown;
  accountNumberKey?: unknown;
  name?: unknown;
  accountType?: unknown;
  normalBalance?: unknown;
  parentAccountId?: unknown;
  isSystemAccount?: unknown;
  isActive?: unknown;
  description?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const VALID_ACCOUNT_TYPES: readonly string[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
const VALID_NORMAL_BALANCES: readonly string[] = ['debit', 'credit'];

function isAccountType(value: unknown): value is LedgerAccountType {
  return typeof value === 'string' && VALID_ACCOUNT_TYPES.includes(value);
}

function isNormalBalance(value: unknown): value is LedgerAccountNormalBalance {
  return typeof value === 'string' && VALID_NORMAL_BALANCES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixLedgerAccountItem(item: WixLedgerAccountItem | undefined): LedgerAccount | null {
  if (
    !item ||
    typeof item.beaconLedgerAccountId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.accountNumber !== 'string' ||
    typeof item.accountNumberKey !== 'string' ||
    typeof item.name !== 'string' ||
    !isAccountType(item.accountType) ||
    !isNormalBalance(item.normalBalance) ||
    !isStringOrNull(item.parentAccountId) ||
    typeof item.isSystemAccount !== 'boolean' ||
    typeof item.isActive !== 'boolean' ||
    !isStringOrNull(item.description) ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconLedgerAccountId,
    organizationId: item.organizationId,
    accountNumber: item.accountNumber,
    accountNumberKey: item.accountNumberKey,
    name: item.name,
    accountType: item.accountType,
    normalBalance: item.normalBalance,
    parentAccountId: item.parentAccountId,
    isSystemAccount: item.isSystemAccount,
    isActive: item.isActive,
    description: item.description,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixLedgerAccountData(account: LedgerAccount): WixLedgerAccountItem {
  return {
    beaconLedgerAccountId: account.id,
    organizationId: account.organizationId,
    accountNumber: account.accountNumber,
    accountNumberKey: account.accountNumberKey,
    name: account.name,
    accountType: account.accountType,
    normalBalance: account.normalBalance,
    parentAccountId: account.parentAccountId,
    isSystemAccount: account.isSystemAccount,
    isActive: account.isActive,
    description: account.description,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

/** `name`/`description`/`parentAccountId`/`isActive` are the only fields
    `chartOfAccountsService.ts`'s `updateAccount`/`deactivateAccount` ever
    change — `accountType`/`accountNumber` are immutable once created
    (see types/ledgerAccount.ts's own comment on why). */
export function applyLedgerAccountUpdateToWixData(
  existing: WixLedgerAccountItem,
  patch: Partial<Pick<LedgerAccount, 'name' | 'description' | 'parentAccountId' | 'isActive' | 'updatedAt'>>,
): WixLedgerAccountItem {
  return { ...existing, ...patch };
}
