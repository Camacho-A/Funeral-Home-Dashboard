import { describe, expect, it } from 'vitest';
import {
  archivedCaseWriteRefusal,
  isRestorePatch,
  ARCHIVED_CASE_READ_ONLY_MESSAGE,
} from './archivedCaseWrites';

describe('archivedCaseWriteRefusal', () => {
  const live = { isDeleted: false };
  const archived = { isDeleted: true };

  it('never refuses a write to a live case — no new rule applies to one', () => {
    expect(archivedCaseWriteRefusal(live, { decedentName: 'ROBERT ELLISON' })).toBeNull();
    expect(archivedCaseWriteRefusal({}, { decedentName: 'ROBERT ELLISON' })).toBeNull();
    expect(archivedCaseWriteRefusal({ isDeleted: null }, { paymentStatus: 'paid_in_full' })).toBeNull();
  });

  it('refuses an ordinary edit to an archived case', () => {
    expect(archivedCaseWriteRefusal(archived, { decedentName: 'ROBERT ELLISON' })).toBe(
      ARCHIVED_CASE_READ_ONLY_MESSAGE,
    );
    expect(archivedCaseWriteRefusal(archived, { checklistState: { '2:0': true } })).toBe(
      ARCHIVED_CASE_READ_ONLY_MESSAGE,
    );
    expect(archivedCaseWriteRefusal(archived, { paymentStatus: 'paid_in_full' })).toBe(
      ARCHIVED_CASE_READ_ONLY_MESSAGE,
    );
  });

  it('allows the restore — the authorized way out of this state', () => {
    expect(archivedCaseWriteRefusal(archived, { isDeleted: false })).toBeNull();
    expect(archivedCaseWriteRefusal(archived, { isDeleted: false, archivedAt: null })).toBeNull();
  });

  it('refuses a restore that smuggles an edit alongside it', () => {
    // Otherwise "restore" becomes a wrapper that carries any edit past
    // this guard, and the read-only rule means nothing.
    expect(archivedCaseWriteRefusal(archived, { isDeleted: false, decedentName: 'SOMEONE ELSE' })).toBe(
      ARCHIVED_CASE_READ_ONLY_MESSAGE,
    );
  });

  it('re-archiving an already-archived case is not a restore', () => {
    expect(archivedCaseWriteRefusal(archived, { isDeleted: true })).toBe(ARCHIVED_CASE_READ_ONLY_MESSAGE);
  });

  it('an empty patch is not a restore', () => {
    expect(isRestorePatch({})).toBe(false);
    expect(archivedCaseWriteRefusal(archived, {})).toBe(ARCHIVED_CASE_READ_ONLY_MESSAGE);
  });
});
