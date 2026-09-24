import { describe, expect, it } from 'vitest';
import { classifyReconciliationRow, buildReconciliationRows, bulkApplyCandidates } from './reconciliation';

describe('classifyReconciliationRow', () => {
  it('classifies matching values as match, not eligible for bulk apply', () => {
    const row = classifyReconciliationRow('dateOfBirth', '01/02/1950', '01/02/1950');
    expect(row.state).toBe('match');
    expect(row.eligibleForBulkApply).toBe(false);
  });

  it('classifies an empty Solis field as solis_empty, eligible for bulk apply', () => {
    const row = classifyReconciliationRow('nextOfKinEmail', null, 'family@example.com');
    expect(row.state).toBe('solis_empty');
    expect(row.eligibleForBulkApply).toBe(true);
  });

  it('classifies a genuine conflict as conflict, never eligible for bulk apply', () => {
    const row = classifyReconciliationRow('dateOfBirth', '01/02/1950', '01/03/1950');
    expect(row.state).toBe('conflict');
    expect(row.eligibleForBulkApply).toBe(false);
  });

  it('never silently overwrites — a conflict is never pre-selected', () => {
    const row = classifyReconciliationRow('dateOfBirth', '01/02/1950', '01/03/1950');
    expect(row.eligibleForBulkApply).toBe(false);
  });

  it('classifies a field with no existing Case destination as review_only, never appliable', () => {
    const row = classifyReconciliationRow('pickupReleaseRelationship', null, 'Son');
    expect(row.state).toBe('review_only');
    expect(row.eligibleForBulkApply).toBe(false);
  });

  it('treats an incoming empty value as match (nothing to apply)', () => {
    const row = classifyReconciliationRow('nextOfKinEmail', 'existing@example.com', null);
    expect(row.state).toBe('match');
  });
});

describe('buildReconciliationRows / bulkApplyCandidates', () => {
  it('"Apply all new information" only ever includes solis_empty rows', () => {
    const rows = buildReconciliationRows(
      { decedentName: 'Jane Doe', nextOfKinEmail: null, dateOfBirth: '01/02/1950' },
      { decedentName: 'Jane Doe', nextOfKinEmail: 'family@example.com', dateOfBirth: '01/03/1950' },
    );
    const candidates = bulkApplyCandidates(rows);
    expect(candidates).toEqual(['nextOfKinEmail']);
    expect(candidates).not.toContain('dateOfBirth'); // the conflict is excluded
  });
});
