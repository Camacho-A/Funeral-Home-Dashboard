import { describe, it, expect } from 'vitest';
import { mapWixBankReconciliationItem, buildWixBankReconciliationData, applyBankReconciliationUpdateToWixData } from './wixBankReconciliationMapper';
import type { BankReconciliation } from '../types/bankReconciliation';

const RECONCILIATION: BankReconciliation = {
  id: 'reconciliation-1',
  organizationId: 'org-1',
  bankAccountId: 'bank-account-1',
  statementEndingDate: '2026-08-31T00:00:00.000Z',
  statementEndingBalance: 100000,
  bookBalanceAtStart: 95000,
  status: 'in_progress',
  bankStatementImportId: 'import-1',
  completedAt: null,
  completedByStaffProfileId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
};

describe('wixBankReconciliationMapper', () => {
  it('round-trips an in-progress reconciliation', () => {
    expect(mapWixBankReconciliationItem(buildWixBankReconciliationData(RECONCILIATION))).toEqual(RECONCILIATION);
  });

  it('round-trips a completed reconciliation', () => {
    const completed: BankReconciliation = {
      ...RECONCILIATION,
      id: 'reconciliation-2',
      status: 'completed',
      completedAt: '2026-09-01T00:00:00.000Z',
      completedByStaffProfileId: 'staff-dana',
    };
    expect(mapWixBankReconciliationItem(buildWixBankReconciliationData(completed))).toEqual(completed);
  });

  it('returns null for undefined', () => {
    expect(mapWixBankReconciliationItem(undefined)).toBeNull();
  });

  it('returns null for an invalid status', () => {
    expect(mapWixBankReconciliationItem({ ...buildWixBankReconciliationData(RECONCILIATION), status: 'bogus' })).toBeNull();
  });

  it('applyBankReconciliationUpdateToWixData applies only the given patch fields', () => {
    const wixItem = buildWixBankReconciliationData(RECONCILIATION);
    const updated = applyBankReconciliationUpdateToWixData(wixItem, {
      status: 'completed',
      completedAt: '2026-09-01T00:00:00.000Z',
      completedByStaffProfileId: 'staff-dana',
    });
    expect(updated.status).toBe('completed');
    expect(updated.statementEndingBalance).toBe(wixItem.statementEndingBalance);
  });
});
