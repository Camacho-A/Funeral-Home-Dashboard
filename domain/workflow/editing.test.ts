import { describe, expect, it } from 'vitest';
import { moveStage, validateStageSequencing, validateIntakeFields, moveIntakeField } from './editing';
import type { IntakeFieldTemplate, IntakeTemplate, StageTemplate } from '../../types/workflowTemplate';

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

describe('validateIntakeFields (Phase 19 — Configurable Intake Form Builder)', () => {
  function intake(fields: Array<Record<string, unknown>>): IntakeTemplate {
    return { sections: [{ key: 'decedent', label: 'Decedent', fields: fields as never }] };
  }

  it('accepts a well-formed intake', () => {
    const template = intake([
      { key: 'decedentName', label: 'Name of deceased', fieldType: 'text', required: true },
      { key: 'email', label: 'Email', fieldType: 'email', validationType: 'email' },
    ]);
    expect(validateIntakeFields(template)).toEqual([]);
  });

  it('rejects duplicate field keys across the whole intake, even across different sections', () => {
    const template: IntakeTemplate = {
      sections: [
        { key: 's1', label: 'Section 1', fields: [{ key: 'dup', label: 'A' }] },
        { key: 's2', label: 'Section 2', fields: [{ key: 'dup', label: 'B' }] },
      ],
    };
    const errors = validateIntakeFields(template);
    expect(errors.some((e) => e.includes('Duplicate field key "dup"'))).toBe(true);
  });

  it('rejects a blank field key', () => {
    const template = intake([{ key: '', label: 'No key' }]);
    expect(validateIntakeFields(template).some((e) => e.includes('missing a key'))).toBe(true);
  });

  it('rejects a blank field label', () => {
    const template = intake([{ key: 'x', label: '' }]);
    expect(validateIntakeFields(template).some((e) => e.includes('non-empty label'))).toBe(true);
  });

  it('rejects an unrecognized fieldType', () => {
    const template = intake([{ key: 'x', label: 'X', fieldType: 'not-a-real-type' }]);
    expect(validateIntakeFields(template).some((e) => e.includes('unrecognized fieldType'))).toBe(true);
  });

  it('rejects an unrecognized validationType', () => {
    const template = intake([{ key: 'x', label: 'X', validationType: 'not-a-real-validation' }]);
    expect(validateIntakeFields(template).some((e) => e.includes('unrecognized validationType'))).toBe(true);
  });

  it('rejects a select field with no options', () => {
    const template = intake([{ key: 'x', label: 'X', fieldType: 'select', options: [] }]);
    expect(validateIntakeFields(template).some((e) => e.includes('no options'))).toBe(true);
  });

  it('accepts a select field with at least one option', () => {
    const template = intake([{ key: 'x', label: 'X', fieldType: 'select', options: ['A'] }]);
    expect(validateIntakeFields(template)).toEqual([]);
  });

  it('does not require sequential displayOrder — it is a sort hint, not a structural invariant', () => {
    const template = intake([
      { key: 'a', label: 'A', displayOrder: 5 },
      { key: 'b', label: 'B', displayOrder: 100 },
    ]);
    expect(validateIntakeFields(template)).toEqual([]);
  });

  it('accepts an intake with zero sections/fields (the backward-compatible empty case)', () => {
    expect(validateIntakeFields({ sections: [] })).toEqual([]);
  });
});

describe('moveIntakeField (Phase 19 — Configurable Intake Form Builder)', () => {
  function field(key: string, displayOrder: number): IntakeFieldTemplate {
    return { key, label: key, displayOrder };
  }

  it('swaps a field with its upward neighbor and renumbers displayOrder sequentially', () => {
    const fields = [field('a', 0), field('b', 1), field('c', 2)];
    const result = moveIntakeField(fields, 1, 'up');
    expect(result.map((f) => f.key)).toEqual(['b', 'a', 'c']);
    expect(result.map((f) => f.displayOrder)).toEqual([0, 1, 2]);
  });

  it('swaps a field with its downward neighbor', () => {
    const fields = [field('a', 0), field('b', 1)];
    expect(moveIntakeField(fields, 0, 'down').map((f) => f.key)).toEqual(['b', 'a']);
  });

  it('is a no-op moving the first field up or the last field down', () => {
    const fields = [field('a', 0), field('b', 1)];
    expect(moveIntakeField(fields, 0, 'up')).toBe(fields);
    expect(moveIntakeField(fields, 1, 'down')).toBe(fields);
  });

  it('preserves every other property on the moved fields', () => {
    const a: IntakeFieldTemplate = { key: 'a', label: 'A', fieldType: 'email', required: true, validationType: 'email' };
    const b: IntakeFieldTemplate = { key: 'b', label: 'B', fieldType: 'select', options: ['x'] };
    const result = moveIntakeField([a, b], 0, 'down');
    expect(result[0]).toMatchObject({ key: 'b', fieldType: 'select', options: ['x'] });
    expect(result[1]).toMatchObject({ key: 'a', fieldType: 'email', required: true, validationType: 'email' });
  });
});
