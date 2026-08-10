import { describe, it, expect } from 'vitest';
import { mapWixBankDepositItem, buildWixBankDepositData } from './wixBankDepositMapper';
import type { BankDeposit } from '../types/bankDeposit';

const DEPOSIT: BankDeposit = {
  id: 'deposit-1',
  organizationId: 'org-1',
  bankAccountId: 'bank-account-1',
  depositDate: '2026-08-01T00:00:00.000Z',
  totalAmount: 5000,
  includedPaymentRecordIds: ['payment-1', 'payment-2'],
  journalEntryId: 'entry-1',
  memo: 'Weekly deposit',
  createdAt: '2026-08-01T00:00:00.000Z',
  createdByStaffProfileId: 'staff-dana',
};

describe('wixBankDepositMapper', () => {
  it('round-trips a deposit with multiple included payments', () => {
    expect(mapWixBankDepositItem(buildWixBankDepositData(DEPOSIT))).toEqual(DEPOSIT);
  });

  it('round-trips a deposit with a single payment and no memo', () => {
    const single: BankDeposit = { ...DEPOSIT, id: 'deposit-2', includedPaymentRecordIds: ['payment-3'], memo: null };
    expect(mapWixBankDepositItem(buildWixBankDepositData(single))).toEqual(single);
  });

  it('returns null for undefined', () => {
    expect(mapWixBankDepositItem(undefined)).toBeNull();
  });

  it('returns null when includedPaymentRecordIds is not a string array', () => {
    expect(mapWixBankDepositItem({ ...buildWixBankDepositData(DEPOSIT), includedPaymentRecordIds: 'not-an-array' })).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixBankDepositItem({ ...buildWixBankDepositData(DEPOSIT), totalAmount: '5000' })).toBeNull();
  });
});
