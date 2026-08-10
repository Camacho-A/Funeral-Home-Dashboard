import { describe, it, expect } from 'vitest';
import { mapWixJournalEntryItem, buildWixJournalEntryData, applyJournalEntryUpdateToWixData } from './wixJournalEntryMapper';
import type { JournalEntry } from '../types/journalEntry';

const ENTRY: JournalEntry = {
  id: 'entry-1',
  organizationId: 'org-1',
  entryNumber: 'JE-000001',
  entryNumberKey: 'org-1:JE-000001',
  entryDate: '2026-08-01T00:00:00.000Z',
  status: 'posted',
  sourceType: 'payment',
  sourceReferenceId: 'payment-1',
  caseId: 'case-1',
  memo: 'Payment posted',
  reversesEntryId: null,
  postedAt: '2026-08-01T00:00:00.000Z',
  postedByStaffProfileId: 'staff-dana',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('wixJournalEntryMapper', () => {
  it('round-trips a posted entry', () => {
    expect(mapWixJournalEntryItem(buildWixJournalEntryData(ENTRY))).toEqual(ENTRY);
  });

  it('round-trips a reversing entry', () => {
    const reversal: JournalEntry = { ...ENTRY, id: 'entry-2', sourceType: 'reversal', reversesEntryId: 'entry-1' };
    expect(mapWixJournalEntryItem(buildWixJournalEntryData(reversal))).toEqual(reversal);
  });

  it('round-trips a manual draft entry with no actor yet', () => {
    const draft: JournalEntry = { ...ENTRY, id: 'entry-3', status: 'draft', sourceType: 'manual', postedAt: null, postedByStaffProfileId: null };
    expect(mapWixJournalEntryItem(buildWixJournalEntryData(draft))).toEqual(draft);
  });

  it('returns null for undefined', () => {
    expect(mapWixJournalEntryItem(undefined)).toBeNull();
  });

  it('returns null for an invalid status', () => {
    expect(mapWixJournalEntryItem({ ...buildWixJournalEntryData(ENTRY), status: 'bogus' })).toBeNull();
  });

  it('returns null for an invalid sourceType', () => {
    expect(mapWixJournalEntryItem({ ...buildWixJournalEntryData(ENTRY), sourceType: 'bogus' })).toBeNull();
  });

  it('applyJournalEntryUpdateToWixData applies only the given patch fields', () => {
    const wixItem = buildWixJournalEntryData({ ...ENTRY, status: 'draft', postedAt: null, postedByStaffProfileId: null });
    const updated = applyJournalEntryUpdateToWixData(wixItem, { status: 'posted', postedAt: '2026-08-02T00:00:00.000Z', postedByStaffProfileId: 'staff-dana' });
    expect(updated.status).toBe('posted');
    expect(updated.entryNumber).toBe(wixItem.entryNumber);
  });
});
