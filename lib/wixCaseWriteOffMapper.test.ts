import { describe, it, expect } from 'vitest';
import { mapWixCaseWriteOffItem, buildWixCaseWriteOffData } from './wixCaseWriteOffMapper';
import type { CaseWriteOff } from '../types/caseWriteOff';

const WRITE_OFF: CaseWriteOff = {
  id: 'write-off-1',
  organizationId: 'org-1',
  caseId: 'case-1',
  amount: 15000,
  journalEntryId: 'entry-1',
  reason: 'Uncollectible balance after 120 days',
  performedByStaffProfileId: 'staff-dana',
  createdAt: '2026-08-01T00:00:00.000Z',
};

describe('wixCaseWriteOffMapper', () => {
  it('round-trips a write-off', () => {
    expect(mapWixCaseWriteOffItem(buildWixCaseWriteOffData(WRITE_OFF))).toEqual(WRITE_OFF);
  });

  it('round-trips a write-off with no known performer', () => {
    const systemGenerated: CaseWriteOff = { ...WRITE_OFF, id: 'write-off-2', performedByStaffProfileId: null };
    expect(mapWixCaseWriteOffItem(buildWixCaseWriteOffData(systemGenerated))).toEqual(systemGenerated);
  });

  it('returns null for undefined', () => {
    expect(mapWixCaseWriteOffItem(undefined)).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixCaseWriteOffItem({ ...buildWixCaseWriteOffData(WRITE_OFF), amount: '15000' })).toBeNull();
  });
});
