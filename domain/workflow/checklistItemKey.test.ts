import { describe, expect, it } from 'vitest';
import type { Case } from '../../types/case';
import {
  checklistItemKey,
  readChecklistValue,
  writeChecklistValue,
  isCompositeChecklistKey,
  findInvalidChecklistStatePatchEntries,
} from './checklistItemKey';

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
 *
 * Legacy-fallback retirement (2026-10): the temporary bare-key read
 * compatibility window (which, for a short period, reinterpreted a bare
 * `{"1": true}` as belonging to whichever stage was the case's current
 * one at read time) has been removed — the production migration
 * converted both active cases to composite keys and a read-only
 * organization-wide scan confirmed zero cases still carry a bare one.
 * `readChecklistValue` now takes only 3 arguments (no `currentDisplayStage`)
 * and a bare key is simply never a recognized shape, under any
 * circumstance — see the dedicated describe block below.
 */
describe('checklistItemKey', () => {
  it('builds a "{displayStage}:{index}" composite key', () => {
    expect(checklistItemKey(3, 1)).toBe('3:1');
    expect(checklistItemKey(0, 0)).toBe('0:0');
  });
});

describe('isCompositeChecklistKey', () => {
  it('is true for a composite key, false for a bare numeric string or anything else', () => {
    expect(isCompositeChecklistKey('3:1')).toBe(true);
    expect(isCompositeChecklistKey('1')).toBe(false);
    expect(isCompositeChecklistKey('abc')).toBe(false);
  });
});

describe('readChecklistValue', () => {
  it('reads the composite key when present', () => {
    expect(readChecklistValue({ '3:1': true }, 3, 1)).toBe(true);
    expect(readChecklistValue({ '3:1': false }, 3, 1)).toBe(false);
  });

  it('returns undefined when nothing is recorded at all', () => {
    expect(readChecklistValue({}, 3, 1)).toBeUndefined();
  });

  it('a composite key for a DIFFERENT stage never leaks into this read, even if present in the same map', () => {
    expect(readChecklistValue({ '4:1': true }, 3, 1)).toBeUndefined();
  });

  it('a bare numeric key is NEVER interpreted as checklist completion, for any stage, under any circumstance — the legacy fallback has been fully retired', () => {
    // Bare "1" must never satisfy displayStage 1's own item 1 — not even
    // when the displayStage number happens to coincide with the bare
    // key's own digits. It is simply not a recognized key shape anymore.
    expect(readChecklistValue({ '1': true }, 1, 1)).toBeUndefined();
    // Nor any other stage, which was already true even during the
    // retired fallback's compatibility window — reconfirmed here as a
    // permanent guarantee, not a window-dependent one.
    expect(readChecklistValue({ '1': true }, 4, 1)).toBeUndefined();
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
    expect(readChecklistValue(afterCheckingStageA, 4, 1)).toBeUndefined();
    // Reading Permit's (stage 3) own item 1 correctly reflects the write.
    expect(readChecklistValue(afterCheckingStageA, 3, 1)).toBe(true);
  });

  it('UNCHECK direction — toggling one stage\'s item to false never clears a different stage\'s own, independently completed item at the same local index', () => {
    // EDRS (stage 2, local index 2) genuinely completed; Ready for Pickup
    // (stage 5) also happens to use local index 2 for one of its own items.
    const base = writeChecklistValue({}, 2, 2, true); // EDRS's own item done
    // Staff now unchecks what they believe is Ready for Pickup's own item 2
    // (reacting to a bogus display, or just a genuine correction attempt).
    const afterUncheckingStageB = writeChecklistValue(base, 5, 2, false);
    // EDRS's own item must be completely unaffected.
    expect(readChecklistValue(afterUncheckingStageB, 2, 2)).toBe(true);
    // Ready for Pickup's own item correctly reflects the uncheck.
    expect(readChecklistValue(afterUncheckingStageB, 5, 2)).toBe(false);
  });

  it('round-trip: check then uncheck the SAME stage+index correctly toggles only that one key', () => {
    const checked = writeChecklistValue({}, 3, 1, true);
    const unchecked = writeChecklistValue(checked, 3, 1, false);
    expect(unchecked).toEqual({ '3:1': false });
  });
});

describe('findInvalidChecklistStatePatchEntries', () => {
  it('accepts a valid new composite key with no workflowSnapshot to check against', () => {
    expect(findInvalidChecklistStatePatchEntries({}, { '3:1': true }, null)).toEqual([]);
  });

  it('rejects a newly-introduced bare numeric key', () => {
    const errors = findInvalidChecklistStatePatchEntries({}, { '1': true }, null);
    expect(errors).toHaveLength(1);
    expect(errors[0].key).toBe('1');
    expect(errors[0].reason).toMatch(/canonical/);
  });

  it('rejects a non-boolean value', () => {
    const errors = findInvalidChecklistStatePatchEntries({}, { '3:1': 'true' as unknown as boolean }, null);
    expect(errors[0].reason).toMatch(/boolean/);
  });

  it('rejects a malformed composite key', () => {
    expect(findInvalidChecklistStatePatchEntries({}, { 'a:1': true }, null)[0].reason).toMatch(/canonical/);
    expect(findInvalidChecklistStatePatchEntries({}, { '3:b': true }, null)[0].reason).toMatch(/canonical/);
    expect(findInvalidChecklistStatePatchEntries({}, { '-1:1': true }, null)[0].reason).toMatch(/canonical/);
  });

  it('never flags a key whose value is unchanged from what is already stored — even a non-canonical one — so a carried-forward value can never brick an unrelated edit', () => {
    expect(findInvalidChecklistStatePatchEntries({ '1': true }, { '1': true }, null)).toEqual([]);
  });

  it('still flags that same key if its value actually changes', () => {
    const errors = findInvalidChecklistStatePatchEntries({ '1': true }, { '1': false }, null);
    expect(errors).toHaveLength(1);
  });
});

/**
 * Manors intake-stage combination (2026-10). The two historical intake
 * stages now PRESENT as one user-facing stage ("Intake & JotForm"), but
 * they remain two distinct canonical display stages — which is exactly
 * what keeps their checklist completion separate. These guard the
 * invariant the combination depends on: First Call completion can never
 * be read as Arrangement/JotForm completion, or vice versa.
 *
 * This is why the combination was implemented as a presentation overlay
 * rather than by remapping `displayStage` in the workflow template: a real
 * Manors case already carries the key "1:0" (its completed JotForm item),
 * and remapping that stage to display 0 would reinterpret it as "0:0" —
 * "Name of deceased" in the First Call checklist.
 */
describe('composite keys survive the Manors intake-stage combination', () => {
  it('keeps First Call and JotForm Application keys distinct at the same local index', () => {
    expect(checklistItemKey(0, 0)).toBe('0:0'); // First Call — "Name of deceased"
    expect(checklistItemKey(1, 0)).toBe('1:0'); // JotForm Application — its own item
    expect(checklistItemKey(0, 0)).not.toBe(checklistItemKey(1, 0));
  });

  it('does not let First Call completion satisfy the JotForm item', () => {
    const firstCallDone: Case['checklistState'] = { [checklistItemKey(0, 0)]: true };
    expect(readChecklistValue(firstCallDone, 0, 0)).toBe(true);
    expect(readChecklistValue(firstCallDone, 1, 0)).toBeUndefined();
  });

  it('does not let JotForm completion satisfy or overwrite First Call state', () => {
    const jotformDone: Case['checklistState'] = { [checklistItemKey(1, 0)]: true };
    expect(readChecklistValue(jotformDone, 1, 0)).toBe(true);
    expect(readChecklistValue(jotformDone, 0, 0)).toBeUndefined();
  });

  it('keeps both milestones independently recorded when both are complete', () => {
    let state: Case['checklistState'] = {};
    state = writeChecklistValue(state, 0, 0, true);
    state = writeChecklistValue(state, 1, 0, true);

    expect(readChecklistValue(state, 0, 0)).toBe(true);
    expect(readChecklistValue(state, 1, 0)).toBe(true);
    expect(Object.keys(state).sort()).toEqual(['0:0', '1:0']);
  });

  it('reads a real production-shaped key set without cross-stage leakage', () => {
    // Shaped after a real Manors case: First Call items plus the JotForm
    // item plus later stages, all under their own canonical display stage.
    const state: Case['checklistState'] = {
      '0:8': true,
      '0:10': true,
      '1:0': true,
      '2:2': true,
      '3:1': true,
      '4:0': true,
    };

    expect(readChecklistValue(state, 1, 0)).toBe(true); // JotForm, intact
    expect(readChecklistValue(state, 0, 0)).toBeUndefined(); // never invented
    expect(readChecklistValue(state, 0, 8)).toBe(true);
    expect(readChecklistValue(state, 2, 2)).toBe(true);
  });
});
