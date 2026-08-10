import { describe, it, expect } from 'vitest';
import { mapWixLedgerAccountItem, buildWixLedgerAccountData, applyLedgerAccountUpdateToWixData } from './wixLedgerAccountMapper';
import type { LedgerAccount } from '../types/ledgerAccount';

const ACCOUNT: LedgerAccount = {
  id: 'account-1',
  organizationId: 'org-1',
  accountNumber: '1200',
  accountNumberKey: 'org-1:1200',
  name: 'Accounts Receivable',
  accountType: 'asset',
  normalBalance: 'debit',
  parentAccountId: null,
  isSystemAccount: true,
  isActive: true,
  description: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('wixLedgerAccountMapper', () => {
  it('round-trips a system account', () => {
    expect(mapWixLedgerAccountItem(buildWixLedgerAccountData(ACCOUNT))).toEqual(ACCOUNT);
  });

  it('round-trips a custom account with a parent', () => {
    const child: LedgerAccount = { ...ACCOUNT, id: 'account-2', isSystemAccount: false, parentAccountId: 'account-1' };
    expect(mapWixLedgerAccountItem(buildWixLedgerAccountData(child))).toEqual(child);
  });

  it('returns null for undefined', () => {
    expect(mapWixLedgerAccountItem(undefined)).toBeNull();
  });

  it('returns null for an invalid accountType', () => {
    expect(mapWixLedgerAccountItem({ ...buildWixLedgerAccountData(ACCOUNT), accountType: 'bogus' })).toBeNull();
  });

  it('returns null for an invalid normalBalance', () => {
    expect(mapWixLedgerAccountItem({ ...buildWixLedgerAccountData(ACCOUNT), normalBalance: 'bogus' })).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixLedgerAccountItem({ ...buildWixLedgerAccountData(ACCOUNT), isActive: 'true' })).toBeNull();
  });

  it('applyLedgerAccountUpdateToWixData applies only the given patch fields', () => {
    const wixItem = buildWixLedgerAccountData(ACCOUNT);
    const updated = applyLedgerAccountUpdateToWixData(wixItem, { isActive: false, updatedAt: '2026-08-15T00:00:00.000Z' });
    expect(updated.isActive).toBe(false);
    expect(updated.accountNumber).toBe(wixItem.accountNumber);
  });
});
