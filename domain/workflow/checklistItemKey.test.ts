import { describe, expect, it } from 'vitest';
import {
  checklistItemKey,
  readChecklistValue,
  writeChecklistValue,
  isCompositeChecklistKey,
  findLegacyChecklistKeys,
} from './checklistItemKey';
import type { Case } from '../../types/case';

/**
 * B2026-035 (2026-10) — direct unit coverage for the stage-scoped
 * checklist identity helpers, independent of the full
 * resolveChecklist/computeFirstIncompleteRawStage machinery.
 *
 * Explicitly covers BOTH directions of the data-integrity defect the real
 * incident exposed: checking one stage's item must never read as
 * completing a different stage's own item at the same local index (the
 * original B2026-035 over-advancement), AND unchecking/toggling-false one
 * stage's item must never clear a different stage's own, independently
 * completed item at the same local index (the collateral EDRS corruption
 * found during the activity-log reconstruction — the later rapid unchecks
 * on Ready for Pickup's items momentarily shared a flat key with EDRS's
 * own genuinely-completed item under the old architecture).
 */
describe('checklistItemKey', () => {
  it('builds a "{displayStage}:{index}" composite key', () => {
    expect(checklistItemKey(3, 1)).toBe('3:1');
    expect(checklistItemKey(0, 0)).toBe('0:0');
  });
});

describe('isCompositeChecklistKey', () => {
  it('is true for a composite key, false for a bare legacy numeric key', () => {
    expect(isCompositeChecklistKey('3:1')).toBe(true);
    expect(isCompositeChecklistKey('1')).toBe(false);
    expect(isCompositeChecklistKey('abc')).toBe(false);
  });
});

describe('readChecklistValue', () => {
  it('reads the composite key when present', () => {
    expect(readChecklistValue({ '3:1': true }, 3, 1, 3)).toBe(true);
    expect(readChecklistValue({ '3:1': false }, 3, 1, 3)).toBe(false);
  });

  it('falls back to a bare legacy key only when the stage being read IS the case\'s own current display stage', () => {
    expect(readChecklistValue({ '1': true }, 4, 1, 4)).toBe(true); // reading stage 4, case currently at stage 4
  });

  it('never honors a bare legacy key for any stage other than the case\'s current one — returns undefined, never guessed', () => {
    expect(readChecklistValue({ '1': true }, 5, 1, 4)).toBeUndefined(); // reading stage 5, case currently at stage 4
  });

  it('returns undefined when nothing is recorded at all', () => {
    expect(readChecklistValue({}, 3, 1, 3)).toBeUndefined();
  });

  it('a composite key for a DIFFERENT stage never leaks into this read, even if present in the same map', () => {
    expect(readChecklistValue({ '4:1': true }, 3, 1, 3)).toBeUndefined();
  });
});

describe('writeChecklistValue', () => {
  it('sets only the targeted composite key, preserving every other existing entry untouched', () => {
    const result = writeChecklistValue({ '2:0': true, '3:1': true }, 4, 1, true);
    expect(result).toEqual({ '2:0': true, '3:1': true, '4:1': true });
  });

  it('CHECK direction — writing one stage\'s item never marks a different stage\'s own item at the same local index as done', () => {
    const afterCheckingStageA = writeChecklistValue({}, 3, 1, true); // Permit's own item 1
    // Reading DC Application Sent's (stage 4) own item 1 must still be unset.
    expect(readChecklistValue(afterCheckingStageA, 4, 1, 3)).toBeUndefined();
    // Reading Permit's (stage 3) own item 1 correctly reflects the write.
    expect(readChecklistValue(afterCheckingStageA, 3, 1, 3)).toBe(true);
  });

  it('UNCHECK direction — toggling one stage\'s item to false never clears a different stage\'s own, independently completed item at the same local index', () => {
    // EDRS (stage 2, local index 2) genuinely completed; Ready for Pickup
    // (stage 5) also happens to use local index 2 for one of its own items.
    const base = writeChecklistValue({}, 2, 2, true); // EDRS's own item done
    // Staff now unchecks what they believe is Ready for Pickup's own item 2
    // (reacting to a bogus display, or just a genuine correction attempt).
    const afterUncheckingStageB = writeChecklistValue(base, 5, 2, false);
    // EDRS's own item must be completely unaffected.
    expect(readChecklistValue(afterUncheckingStageB, 2, 2, 5)).toBe(true);
    // Ready for Pickup's own item correctly reflects the uncheck.
    expect(readChecklistValue(afterUncheckingStageB, 5, 2, 5)).toBe(false);
  });

  it('round-trip: check then uncheck the SAME stage+index correctly toggles only that one key', () => {
    const checked = writeChecklistValue({}, 3, 1, true);
    const unchecked = writeChecklistValue(checked, 3, 1, false);
    expect(unchecked).toEqual({ '3:1': false });
  });
});

describe('findLegacyChecklistKeys', () => {
  function caseWithChecklistState(checklistState: Case['checklistState']): Case {
    return { checklistState } as Case;
  }

  it('returns every bare (non-composite) key present', () => {
    const case_ = caseWithChecklistState({ '1': true, '8': false, '3:1': true });
    expect(findLegacyChecklistKeys(case_).sort()).toEqual(['1', '8']);
  });

  it('returns an empty array once every key has been migrated to composite form', () => {
    const case_ = caseWithChecklistState({ '3:1': true, '4:0': false });
    expect(findLegacyChecklistKeys(case_)).toEqual([]);
  });

  it('returns an empty array for an empty checklistState', () => {
    expect(findLegacyChecklistKeys(caseWithChecklistState({}))).toEqual([]);
  });
});
