import { describe, expect, it } from 'vitest';
import { moveStage, validateStageSequencing } from './editing';
import type { StageTemplate } from '../../types/workflowTemplate';

function stage(rawStage: number, label: string, itemCount = 1): StageTemplate {
  return {
    rawStage,
    displayStage: rawStage,
    label,
    isAttentionStage: false,
    slaTargetDays: 1,
    checklist: {
      items: Array.from({ length: itemCount }, (_, i) => ({ index: i, label: `${label} item ${i}`, hasField: false })),
    },
  };
}

describe('moveStage', () => {
  it('swaps a stage with its upward neighbor and renumbers sequentially', () => {
    const stages = [stage(0, 'A'), stage(1, 'B'), stage(2, 'C')];
    const result = moveStage(stages, 1, 'up');

    expect(result.map((s) => s.label)).toEqual(['B', 'A', 'C']);
    expect(result.map((s) => s.rawStage)).toEqual([0, 1, 2]);
    expect(result.map((s) => s.displayStage)).toEqual([0, 1, 2]);
  });

  it('swaps a stage with its downward neighbor', () => {
    const stages = [stage(0, 'A'), stage(1, 'B'), stage(2, 'C')];
    const result = moveStage(stages, 0, 'down');
    expect(result.map((s) => s.label)).toEqual(['B', 'A', 'C']);
  });

  it('is a no-op when moving the first stage up', () => {
    const stages = [stage(0, 'A'), stage(1, 'B')];
    const result = moveStage(stages, 0, 'up');
    expect(result).toBe(stages);
  });

  it('is a no-op when moving the last stage down', () => {
    const stages = [stage(0, 'A'), stage(1, 'B')];
    const result = moveStage(stages, 1, 'down');
    expect(result).toBe(stages);
  });

  it('is a no-op for an out-of-range index', () => {
    const stages = [stage(0, 'A')];
    expect(moveStage(stages, 5, 'up')).toBe(stages);
    expect(moveStage(stages, -1, 'down')).toBe(stages);
  });

  it('preserves every other field on the moved stages (label edits, SLA, attention flag, checklist)', () => {
    const a = { ...stage(0, 'A'), isAttentionStage: true, slaTargetDays: 3 };
    const b = stage(1, 'B', 2);
    const result = moveStage([a, b], 0, 'down');

    expect(result[0]).toMatchObject({ label: 'B', rawStage: 0, displayStage: 0 });
    expect(result[1]).toMatchObject({ label: 'A', isAttentionStage: true, slaTargetDays: 3, rawStage: 1, displayStage: 1 });
    expect(result[1].checklist.items).toHaveLength(1);
  });
});

describe('validateStageSequencing', () => {
  it('accepts a well-formed stages array', () => {
    const stages = [stage(0, 'A'), stage(1, 'B')];
    expect(validateStageSequencing(stages)).toEqual([]);
  });

  it('rejects an empty stages array', () => {
    expect(validateStageSequencing([])).toEqual(['At least one stage is required.']);
  });

  it('rejects a gap in rawStage sequencing', () => {
    const stages = [stage(0, 'A'), stage(2, 'B')];
    const errors = validateStageSequencing(stages);
    expect(errors.some((e) => e.includes('rawStage 2, expected 1'))).toBe(true);
  });

  it('rejects a blank stage label', () => {
    const stages = [stage(0, ''), stage(1, 'B')];
    const errors = validateStageSequencing(stages);
    expect(errors.some((e) => e.includes('non-empty label'))).toBe(true);
  });

  it('rejects a negative SLA target', () => {
    const stages = [{ ...stage(0, 'A'), slaTargetDays: -1 }];
    const errors = validateStageSequencing(stages);
    expect(errors.some((e) => e.includes('negative SLA target'))).toBe(true);
  });

  it('allows a null SLA target (no target set)', () => {
    const stages = [{ ...stage(0, 'A'), slaTargetDays: null }];
    expect(validateStageSequencing(stages)).toEqual([]);
  });

  it('rejects a gap in checklist item indices', () => {
    const withGap = stage(0, 'A', 1);
    withGap.checklist.items.push({ index: 5, label: 'orphan', hasField: false });
    const errors = validateStageSequencing([withGap]);
    expect(errors.some((e) => e.includes('index 5, expected 1'))).toBe(true);
  });

  it('rejects a blank checklist item label', () => {
    const withBlank = stage(0, 'A', 1);
    withBlank.checklist.items[0].label = '  ';
    const errors = validateStageSequencing([withBlank]);
    expect(errors.some((e) => e.includes('must have a non-empty label'))).toBe(true);
  });
});
