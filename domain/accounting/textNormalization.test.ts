import { describe, expect, it } from 'vitest';
import {
  normalizeVendorBillTextFields,
  normalizeExpenseDescription,
  normalizeManualJournalEntryMemo,
  normalizeManualJournalEntryLineDescription,
  normalizeWriteOffTextFields,
  normalizeCashAdvanceTextFields,
} from './textNormalization';

describe('normalizeVendorBillTextFields', () => {
  it('uppercases notes', () => {
    expect(normalizeVendorBillTextFields({ notes: 'net 30, freight prepaid' })).toEqual({ notes: 'NET 30, FREIGHT PREPAID' });
  });
  it('passes null through unchanged', () => {
    expect(normalizeVendorBillTextFields({ notes: null })).toEqual({ notes: null });
  });
});

describe('normalizeExpenseDescription', () => {
  it('uppercases a description', () => {
    expect(normalizeExpenseDescription('freight charge')).toBe('FREIGHT CHARGE');
  });
  it('passes null through unchanged', () => {
    expect(normalizeExpenseDescription(null)).toBeNull();
  });
});

describe('normalizeManualJournalEntryMemo', () => {
  it('uppercases a manual entry memo', () => {
    expect(normalizeManualJournalEntryMemo('reclassify march accrual')).toBe('RECLASSIFY MARCH ACCRUAL');
  });
});

describe('normalizeManualJournalEntryLineDescription', () => {
  it('uppercases a line description', () => {
    expect(normalizeManualJournalEntryLineDescription('correction for case 1042')).toBe('CORRECTION FOR CASE 1042');
  });
  it('passes null through unchanged', () => {
    expect(normalizeManualJournalEntryLineDescription(null)).toBeNull();
  });
  it('passes undefined through unchanged', () => {
    expect(normalizeManualJournalEntryLineDescription(undefined)).toBeUndefined();
  });
});

describe('normalizeWriteOffTextFields', () => {
  it('uppercases reason', () => {
    expect(normalizeWriteOffTextFields({ reason: 'family unable to pay balance' })).toEqual({ reason: 'FAMILY UNABLE TO PAY BALANCE' });
  });
});

describe('normalizeCashAdvanceTextFields', () => {
  it('uppercases description', () => {
    expect(normalizeCashAdvanceTextFields({ description: 'certified death certificates (5)' })).toEqual({
      description: 'CERTIFIED DEATH CERTIFICATES (5)',
    });
  });
});
