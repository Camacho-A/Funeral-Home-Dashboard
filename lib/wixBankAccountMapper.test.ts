import { describe, it, expect } from 'vitest';
import { mapWixBankAccountItem, buildWixBankAccountData, applyBankAccountUpdateToWixData } from './wixBankAccountMapper';
import type { BankAccount } from '../types/bankAccount';

const ACCOUNT: BankAccount = {
  id: 'bank-account-1',
  organizationId: 'org-1',
  name: 'Operating Checking',
  ledgerAccountId: 'account-1010',
  accountNumberLast4: '4321',
  bankName: 'First National',
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('wixBankAccountMapper', () => {
  it('round-trips a bank account', () => {
    expect(mapWixBankAccountItem(buildWixBankAccountData(ACCOUNT))).toEqual(ACCOUNT);
  });

  it('round-trips with nullable display fields absent', () => {
    const minimal: BankAccount = { ...ACCOUNT, id: 'bank-account-2', accountNumberLast4: null, bankName: null };
    expect(mapWixBankAccountItem(buildWixBankAccountData(minimal))).toEqual(minimal);
  });

  it('returns null for undefined', () => {
    expect(mapWixBankAccountItem(undefined)).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixBankAccountItem({ ...buildWixBankAccountData(ACCOUNT), ledgerAccountId: undefined })).toBeNull();
  });

  it('applyBankAccountUpdateToWixData applies only the given patch fields', () => {
    const wixItem = buildWixBankAccountData(ACCOUNT);
    const updated = applyBankAccountUpdateToWixData(wixItem, { isActive: false, updatedAt: '2026-08-15T00:00:00.000Z' });
    expect(updated.isActive).toBe(false);
    expect(updated.name).toBe(wixItem.name);
  });
});
