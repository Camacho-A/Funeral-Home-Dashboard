import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import {
  mapWixLedgerAccountItem,
  buildWixLedgerAccountData,
  applyLedgerAccountUpdateToWixData,
  type WixLedgerAccountItem,
} from '../lib/wixLedgerAccountMapper';
import type { LedgerAccount } from '../types/ledgerAccount';
import { STARTER_CHART_OF_ACCOUNTS } from '../domain/ledger/starterChartOfAccounts';
import { ledgerAccountFixtures } from './__mocks__/ledgerFixtures';
import { recordLedgerAccountCreated, recordLedgerAccountDeactivated, type ActivityContext } from './activityService';

/**
 * Phase 31 (Financial Management & General Ledger). Owns the
 * `chartOfAccounts` collection exclusively — see
 * docs/adr/ADR-035-financial-management-and-general-ledger.md.
 *
 * `accountNumber` is a clean, user-facing display value; `accountNumberKey`
 * (`{organizationId}:{accountNumber}`) is the internal field the real Wix
 * unique index sits on — see types/ledgerAccount.ts's own comment on why
 * these are two separate fields rather than one composed display value
 * (mirroring `PaymentRecord.idempotencyKey`'s approach, which is safe
 * there only because that field is never shown to a user).
 *
 * No caching, mirroring services/permissionService.ts's own explicit
 * no-cache rule (a real Phase 22 incident, not theoretical) — every
 * resolution here is a fresh read, every call.
 */
export class ChartOfAccountsServiceError extends Error {}

function nowIso(): string {
  return new Date().toISOString();
}

function accountNumberKey(organizationId: string, accountNumber: string): string {
  return `${organizationId}:${accountNumber}`;
}

export async function listAccounts(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<LedgerAccount[]> {
  if (dataAdapterMode === 'mock') {
    return ledgerAccountFixtures.filter((a) => a.organizationId === organizationId);
  }
  const response = await queryWixDataItems<WixLedgerAccountItem>('chartOfAccounts', { filter: { organizationId } });
  return response.dataItems.map((item) => mapWixLedgerAccountItem(item.data)).filter((a): a is LedgerAccount => a !== null);
}

export async function getAccountById(
  organizationId: string,
  accountId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<LedgerAccount | null> {
  if (dataAdapterMode === 'mock') {
    return ledgerAccountFixtures.find((a) => a.id === accountId && a.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixLedgerAccountItem>('chartOfAccounts', {
    filter: { organizationId, beaconLedgerAccountId: accountId },
    paging: { limit: 1 },
  });
  return mapWixLedgerAccountItem(response.dataItems[0]?.data);
}

export async function getAccountByNumber(
  organizationId: string,
  accountNumber: string,
  dataAdapterMode: DataAdapterMode,
): Promise<LedgerAccount | null> {
  if (dataAdapterMode === 'mock') {
    return ledgerAccountFixtures.find((a) => a.organizationId === organizationId && a.accountNumber === accountNumber) ?? null;
  }
  const response = await queryWixDataItems<WixLedgerAccountItem>('chartOfAccounts', {
    filter: { accountNumberKey: accountNumberKey(organizationId, accountNumber) },
    paging: { limit: 1 },
  });
  return mapWixLedgerAccountItem(response.dataItems[0]?.data);
}

export async function createAccount(
  organizationId: string,
  params: {
    accountNumber: string;
    name: string;
    accountType: LedgerAccount['accountType'];
    normalBalance: LedgerAccount['normalBalance'];
    parentAccountId?: string | null;
    isSystemAccount?: boolean;
    description?: string | null;
    idFactory: () => string;
    now?: string;
  },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<LedgerAccount> {
  const existing = await getAccountByNumber(organizationId, params.accountNumber, dataAdapterMode);
  if (existing) {
    throw new ChartOfAccountsServiceError(`An account numbered "${params.accountNumber}" already exists for this organization.`);
  }

  if (params.parentAccountId) {
    const parent = await getAccountById(organizationId, params.parentAccountId, dataAdapterMode);
    if (!parent) {
      throw new ChartOfAccountsServiceError(`Parent account "${params.parentAccountId}" does not exist in this organization.`);
    }
    if (parent.accountType !== params.accountType) {
      throw new ChartOfAccountsServiceError('A child account must share its parent account\'s accountType.');
    }
  }

  const now = params.now ?? nowIso();
  const account: LedgerAccount = {
    id: params.idFactory(),
    organizationId,
    accountNumber: params.accountNumber,
    accountNumberKey: accountNumberKey(organizationId, params.accountNumber),
    name: params.name,
    accountType: params.accountType,
    normalBalance: params.normalBalance,
    parentAccountId: params.parentAccountId ?? null,
    isSystemAccount: params.isSystemAccount ?? false,
    isActive: true,
    description: params.description ?? null,
    createdAt: now,
    updatedAt: now,
  };

  if (dataAdapterMode === 'mock') {
    ledgerAccountFixtures.push(account);
  } else {
    await insertWixDataItem<WixLedgerAccountItem>('chartOfAccounts', buildWixLedgerAccountData(account), account.id);
  }
  await recordLedgerAccountCreated(ctx, account.id, account.accountNumber, account.name, dataAdapterMode);
  return account;
}

/** `name`/`description`/`parentAccountId` only — `accountNumber`/
    `accountType` are immutable once created (see types/ledgerAccount.ts's
    own comment on why: every derived report groups by them). */
export async function updateAccount(
  organizationId: string,
  accountId: string,
  patch: { name?: string; description?: string | null; parentAccountId?: string | null },
  dataAdapterMode: DataAdapterMode,
): Promise<LedgerAccount> {
  const now = nowIso();
  if (dataAdapterMode === 'mock') {
    const index = ledgerAccountFixtures.findIndex((a) => a.id === accountId && a.organizationId === organizationId);
    if (index === -1) throw new ChartOfAccountsServiceError(`No ledger account "${accountId}" exists in this organization.`);
    ledgerAccountFixtures[index] = { ...ledgerAccountFixtures[index], ...patch, updatedAt: now };
    return ledgerAccountFixtures[index];
  }
  const response = await queryWixDataItems<WixLedgerAccountItem>('chartOfAccounts', {
    filter: { organizationId, beaconLedgerAccountId: accountId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new ChartOfAccountsServiceError(`No ledger account "${accountId}" exists in this organization.`);
  const merged = applyLedgerAccountUpdateToWixData(existingItem.data, { ...patch, updatedAt: now });
  const updated = await updateWixDataItem<WixLedgerAccountItem>('chartOfAccounts', existingItem.id, merged);
  const mapped = mapWixLedgerAccountItem(updated.data);
  if (!mapped) throw new ChartOfAccountsServiceError('Failed to update ledger account.');
  return mapped;
}

/** The only other lifecycle transition — a `LedgerAccount` is never
    hard-deleted, so historical journal lines remain attributable to it
    forever. Refuses to deactivate a system (starter) account. */
export async function deactivateAccount(
  organizationId: string,
  accountId: string,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<LedgerAccount> {
  const account = await getAccountById(organizationId, accountId, dataAdapterMode);
  if (!account) throw new ChartOfAccountsServiceError(`No ledger account "${accountId}" exists in this organization.`);
  if (account.isSystemAccount) {
    throw new ChartOfAccountsServiceError('System accounts cannot be deactivated.');
  }

  const now = nowIso();
  let deactivated: LedgerAccount;
  if (dataAdapterMode === 'mock') {
    const index = ledgerAccountFixtures.findIndex((a) => a.id === accountId && a.organizationId === organizationId);
    ledgerAccountFixtures[index] = { ...ledgerAccountFixtures[index], isActive: false, updatedAt: now };
    deactivated = ledgerAccountFixtures[index];
  } else {
    const response = await queryWixDataItems<WixLedgerAccountItem>('chartOfAccounts', {
      filter: { organizationId, beaconLedgerAccountId: accountId },
      paging: { limit: 1 },
    });
    const existingItem = response.dataItems[0];
    if (!existingItem) throw new ChartOfAccountsServiceError(`No ledger account "${accountId}" exists in this organization.`);
    const merged = applyLedgerAccountUpdateToWixData(existingItem.data, { isActive: false, updatedAt: now });
    const updated = await updateWixDataItem<WixLedgerAccountItem>('chartOfAccounts', existingItem.id, merged);
    const mapped = mapWixLedgerAccountItem(updated.data);
    if (!mapped) throw new ChartOfAccountsServiceError('Failed to deactivate ledger account.');
    deactivated = mapped;
  }
  await recordLedgerAccountDeactivated(ctx, deactivated.id, deactivated.accountNumber, dataAdapterMode);
  return deactivated;
}

/**
 * Idempotent (check-then-insert, mirroring
 * services/organizationProvisioningService.ts's `seedServiceCatalog`
 * exactly): if this organization already has any chart-of-accounts rows,
 * returns them unchanged rather than duplicating. Called once at
 * onboarding (services/organizationProvisioningService.ts), and standalone
 * for backfilling the one pre-existing live tenant.
 */
export async function seedChartOfAccounts(
  organizationId: string,
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ accounts: LedgerAccount[]; isNew: boolean }> {
  const existing = await listAccounts(organizationId, dataAdapterMode);
  if (existing.length > 0) return { accounts: existing, isNew: false };

  const now = nowIso();
  const accounts: LedgerAccount[] = STARTER_CHART_OF_ACCOUNTS.map((entry) => ({
    id: idFactory(),
    organizationId,
    accountNumber: entry.accountNumber,
    accountNumberKey: accountNumberKey(organizationId, entry.accountNumber),
    name: entry.name,
    accountType: entry.accountType,
    normalBalance: entry.normalBalance,
    parentAccountId: null,
    isSystemAccount: true,
    isActive: true,
    description: entry.description,
    createdAt: now,
    updatedAt: now,
  }));

  if (dataAdapterMode === 'mock') {
    ledgerAccountFixtures.push(...accounts);
    return { accounts, isNew: true };
  }

  for (const account of accounts) {
    await insertWixDataItem<WixLedgerAccountItem>('chartOfAccounts', buildWixLedgerAccountData(account), account.id);
  }
  return { accounts, isNew: true };
}

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Add-only backfill of any
 * starter accounts an ALREADY-SEEDED organization is missing — because
 * `seedChartOfAccounts` above returns early (adds nothing) once a chart
 * exists, a tenant onboarded before Phase 35 would never receive the five
 * new merchandise accounts (1300/2100/4100/5100/5110). This inserts only the
 * missing numbers, never touching or duplicating an existing account, so it
 * is safe to re-run. Used to backfill Manor's Cremation (the one live tenant)
 * during Phase 35 live verification, exactly the targeted-add pattern Phase
 * 31/32 used for new rolePermissions grants. See
 * docs/adr/ADR-039-merchandise-inventory-and-commerce.md.
 */
export async function backfillMissingStarterAccounts(
  organizationId: string,
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ added: LedgerAccount[] }> {
  const existing = await listAccounts(organizationId, dataAdapterMode);
  const existingNumbers = new Set(existing.map((a) => a.accountNumber));
  const missingEntries = STARTER_CHART_OF_ACCOUNTS.filter((entry) => !existingNumbers.has(entry.accountNumber));
  if (missingEntries.length === 0) return { added: [] };

  const now = nowIso();
  const added: LedgerAccount[] = missingEntries.map((entry) => ({
    id: idFactory(),
    organizationId,
    accountNumber: entry.accountNumber,
    accountNumberKey: accountNumberKey(organizationId, entry.accountNumber),
    name: entry.name,
    accountType: entry.accountType,
    normalBalance: entry.normalBalance,
    parentAccountId: null,
    isSystemAccount: true,
    isActive: true,
    description: entry.description,
    createdAt: now,
    updatedAt: now,
  }));

  if (dataAdapterMode === 'mock') {
    ledgerAccountFixtures.push(...added);
    return { added };
  }
  for (const account of added) {
    await insertWixDataItem<WixLedgerAccountItem>('chartOfAccounts', buildWixLedgerAccountData(account), account.id);
  }
  return { added };
}
