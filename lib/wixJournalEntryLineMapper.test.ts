import { describe, it, expect } from 'vitest';
import { mapWixJournalEntryLineItem, buildWixJournalEntryLineData } from './wixJournalEntryLineMapper';
import type { JournalEntryLine } from '../types/journalEntry';

const LINE: JournalEntryLine = {
  id: 'line-1',
  organizationId: 'org-1',
  journalEntryId: 'entry-1',
  lineNumber: 1,
  accountId: 'account-1100',
  direction: 'debit',
  amount: 1000,
  caseId: 'case-1',
  description: 'Undeposited Funds',
  createdAt: '2026-08-01T00:00:00.000Z',
};

describe('wixJournalEntryLineMapper', () => {
  it('round-trips a debit line', () => {
    expect(mapWixJournalEntryLineItem(buildWixJournalEntryLineData(LINE))).toEqual(LINE);
  });

  it('round-trips a credit line with no case', () => {
    const creditLine: JournalEntryLine = { ...LINE, id: 'line-2', direction: 'credit', caseId: null, description: null };
    expect(mapWixJournalEntryLineItem(buildWixJournalEntryLineData(creditLine))).toEqual(creditLine);
  });

  it('returns null for undefined', () => {
    expect(mapWixJournalEntryLineItem(undefined)).toBeNull();
  });

  it('returns null for an invalid direction', () => {
    expect(mapWixJournalEntryLineItem({ ...buildWixJournalEntryLineData(LINE), direction: 'bogus' })).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixJournalEntryLineItem({ ...buildWixJournalEntryLineData(LINE), amount: '1000' })).toBeNull();
  });
});
