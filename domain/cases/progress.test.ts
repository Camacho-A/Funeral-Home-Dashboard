import { describe, expect, it } from 'vitest';
import { computeCaseProgress } from './progress';
import type { CaseWorkflowSnapshot, StageTemplate } from '../../types/workflowTemplate';
import type { ChecklistItemViewModel } from '../../types/caseViewModel';

function stage(rawStage: number, displayStage: number, itemCount: number): StageTemplate {
  return {
    rawStage,
    displayStage,
    label: `Stage ${displayStage}`,
    slaTargetDays: null,
    checklist: {
      items: Array.from({ length: itemCount }, (_, index) => ({ index, label: `Item ${index}`, hasField: false })),
    },
  };
}

function snapshot(stages: StageTemplate[]): CaseWorkflowSnapshot {
  return { workflowTemplateId: 't', workflowTemplateVersion: 1, stages, intake: { sections: [] } };
}

function checklistItem(index: number, done: boolean): ChecklistItemViewModel {
  return { index, label: `Item ${index}`, done, locked: false, hasField: false, fieldValue: '', fieldIsPassword: false, isDerived: false };
}

/**
 * Case list scalability, Phase 3 (progress indicator, 2026-09). The pure
 * calculation — domain/cases/viewModel.test.ts covers the wiring through
 * buildCaseViewModel (override agreement, 0/partial/100% real cases);
 * this file covers the arithmetic itself in isolation, including the
 * raw-0/raw-1 double-counting trap this function exists specifically to
 * avoid (see its own doc comment).
 */
describe('computeCaseProgress', () => {
  it('a case at display stage 0 with no items done yet is 0%', () => {
    const snap = snapshot([stage(0, 0, 3), stage(1, 1, 2), stage(2, 2, 1)]);
    const currentChecklist = [checklistItem(0, false), checklistItem(1, false), checklistItem(2, false)];
    const result = computeCaseProgress(snap, 0, currentChecklist);
    expect(result).toEqual({ completedItems: 0, totalItems: 6, percent: 0 });
  });

  it('every past stage counts as fully done regardless of this case\'s own checklistState', () => {
    const snap = snapshot([stage(0, 0, 2), stage(1, 1, 2), stage(2, 2, 2)]);
    // At display stage 2 (past: stage 0 + stage 1, both fully credited —
    // 4 items), current stage 2 has 1 of 2 items done.
    const currentChecklist = [checklistItem(0, true), checklistItem(1, false)];
    const result = computeCaseProgress(snap, 2, currentChecklist);
    expect(result).toEqual({ completedItems: 5, totalItems: 6, percent: 83 });
  });

  it('a future stage (not yet reached) contributes 0 completed items but still counts toward the total', () => {
    const snap = snapshot([stage(0, 0, 2), stage(1, 1, 3)]);
    const currentChecklist = [checklistItem(0, true), checklistItem(1, true)];
    const result = computeCaseProgress(snap, 0, currentChecklist);
    // Current stage (2/2) + future stage (0/3) = 2/5, not 2/2 = 100%.
    expect(result).toEqual({ completedItems: 2, totalItems: 5, percent: 40 });
  });

  it('is not simply derived from the stage number/position — two cases at the same stage with different checklist completion get different percentages', () => {
    const snap = snapshot([stage(0, 0, 2), stage(1, 1, 4)]);
    const mostlyDone = [checklistItem(0, true), checklistItem(1, true), checklistItem(2, true), checklistItem(3, false)];
    const mostlyUndone = [checklistItem(0, true), checklistItem(1, false), checklistItem(2, false), checklistItem(3, false)];
    const higher = computeCaseProgress(snap, 1, mostlyDone);
    const lower = computeCaseProgress(snap, 1, mostlyUndone);
    expect(higher.percent).toBeGreaterThan(lower.percent);
  });

  it('a fully-completed final stage, with every prior stage passed, is 100%', () => {
    const snap = snapshot([stage(0, 0, 2), stage(1, 1, 1)]);
    const currentChecklist = [checklistItem(0, true)];
    const result = computeCaseProgress(snap, 1, currentChecklist);
    expect(result).toEqual({ completedItems: 3, totalItems: 3, percent: 100 });
  });

  it('rounds to a whole number — never excessive decimal precision', () => {
    const snap = snapshot([stage(0, 0, 13)]);
    const currentChecklist = Array.from({ length: 13 }, (_, i) => checklistItem(i, i < 10));
    const result = computeCaseProgress(snap, 0, currentChecklist);
    expect(result.percent).toBe(77); // 10/13 = 76.923...%, rounded
    expect(Number.isInteger(result.percent)).toBe(true);
  });

  it('is always bounded within 0-100', () => {
    const snap = snapshot([stage(0, 0, 5)]);
    const noneDone = computeCaseProgress(snap, 0, [checklistItem(0, false)]);
    const allDone = computeCaseProgress(snap, 0, [checklistItem(0, true)]);
    expect(noneDone.percent).toBeGreaterThanOrEqual(0);
    expect(allDone.percent).toBeLessThanOrEqual(100);
  });

  it('Case list scalability, Phase 2 (raw-0/raw-1 combined checklist): two StageTemplate entries sharing one displayStage are never double-counted', () => {
    // Mirrors Managed Cremations' real shape: raw stages 0 and 1 both
    // display as display stage 0 and carry an IDENTICAL item list (see
    // domain/cases/checklist.ts#getChecklistLabels). Summing
    // snapshot.stages directly would count these 11 items twice.
    const combinedItems = stage(0, 0, 11);
    const duplicateRawStageSameDisplay: StageTemplate = { ...combinedItems, rawStage: 1 };
    const snap = snapshot([combinedItems, duplicateRawStageSameDisplay, stage(2, 1, 1)]);
    const currentChecklist = Array.from({ length: 11 }, (_, i) => checklistItem(i, true));
    const result = computeCaseProgress(snap, 0, currentChecklist);
    // 11 (deduplicated current stage, all done) + 1 (future stage) = 12 —
    // NOT 11 + 11 + 1 = 23.
    expect(result).toEqual({ completedItems: 11, totalItems: 12, percent: 92 });
  });
});
