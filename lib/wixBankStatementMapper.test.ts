import { describe, it, expect } from 'vitest';
import {
  mapWixBankStatementImportItem,
  buildWixBankStatementImportData,
  mapWixBankStatementLineItem,
  buildWixBankStatementLineData,
  applyBankStatementLineUpdateToWixData,
} from './wixBankStatementMapper';
import type { BankStatementImport, BankStatementLine } from '../types/bankStatement';

const IMPORT_RECORD: BankStatementImport = {
  id: 'import-1',
  organizationId: 'org-1',
  bankAccountId: 'bank-account-1',
  importedAt: '2026-08-01T00:00:00.000Z',
  fileName: 'august-statement.csv',
  statementPeriodStart: '2026-08-01T00:00:00.000Z',
  statementPeriodEnd: '2026-08-31T00:00:00.000Z',
  lineCount: 12,
  createdByStaffProfileId: 'staff-dana',
};

const LINE: BankStatementLine = {
  id: 'line-1',
  organizationId: 'org-1',
  bankStatementImportId: 'import-1',
  bankAccountId: 'bank-account-1',
  transactionDate: '2026-08-05T00:00:00.000Z',
  description: 'Deposit',
  amount: 5000,
  matchedJournalEntryId: null,
  matchStatus: 'unmatched',
  createdAt: '2026-08-01T00:00:00.000Z',
};

describe('wixBankStatementMapper', () => {
  it('round-trips a statement import', () => {
    expect(mapWixBankStatementImportItem(buildWixBankStatementImportData(IMPORT_RECORD))).toEqual(IMPORT_RECORD);
  });

  it('round-trips a statement import with no fileName/period known', () => {
    const minimal: BankStatementImport = { ...IMPORT_RECORD, id: 'import-2', fileName: null, statementPeriodStart: null, statementPeriodEnd: null };
    expect(mapWixBankStatementImportItem(buildWixBankStatementImportData(minimal))).toEqual(minimal);
  });

  it('returns null for undefined import', () => {
    expect(mapWixBankStatementImportItem(undefined)).toBeNull();
  });

  it('round-trips an unmatched statement line (signed negative amount)', () => {
    const withdrawal: BankStatementLine = { ...LINE, id: 'line-2', amount: -2500 };
    expect(mapWixBankStatementLineItem(buildWixBankStatementLineData(withdrawal))).toEqual(withdrawal);
  });

  it('round-trips an auto-matched line', () => {
    const matched: BankStatementLine = { ...LINE, id: 'line-3', matchStatus: 'auto_matched', matchedJournalEntryId: 'entry-1' };
    expect(mapWixBankStatementLineItem(buildWixBankStatementLineData(matched))).toEqual(matched);
  });

  it('returns null for undefined line', () => {
    expect(mapWixBankStatementLineItem(undefined)).toBeNull();
  });

  it('returns null for an invalid matchStatus', () => {
    expect(mapWixBankStatementLineItem({ ...buildWixBankStatementLineData(LINE), matchStatus: 'bogus' })).toBeNull();
  });

  it('applyBankStatementLineUpdateToWixData applies only matchedJournalEntryId/matchStatus', () => {
    const wixItem = buildWixBankStatementLineData(LINE);
    const updated = applyBankStatementLineUpdateToWixData(wixItem, { matchStatus: 'excluded', matchedJournalEntryId: null });
    expect(updated.matchStatus).toBe('excluded');
    expect(updated.amount).toBe(wixItem.amount);
  });
});
