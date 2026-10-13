import { describe, expect, it } from 'vitest';
import {
  applyMedicalExaminerVariant,
  medicalExaminerStageFor,
  pendingMedicalExaminerPlaceholder,
  MANORS_ORGANIZATION_ID,
} from './medicalExaminerWorkflow';
import type { ChecklistItemTemplate } from '../../types/workflowTemplate';

const EDRS_DISPLAY_STAGE = 2;

const DOCTOR_ITEMS: ChecklistItemTemplate[] = [
  { index: 0, label: 'EDRS submitted & sent to doctor', hasField: false },
  { index: 1, label: 'Cause of death entered', hasField: false },
  { index: 2, label: 'Hardsave for state approval if not an online doctor', hasField: false },
];

const labels = (items: ChecklistItemTemplate[]) => items.map((i) => i.label);

describe('applyMedicalExaminerVariant', () => {
  it('leaves a standard case completely untouched', () => {
    // The normal workflow must not route through any new logic.
    const result = applyMedicalExaminerVariant(DOCTOR_ITEMS, MANORS_ORGANIZATION_ID, EDRS_DISPLAY_STAGE, false);
    expect(result).toBe(DOCTOR_ITEMS);
  });

  it('replaces the doctor items with ME verification items', () => {
    const result = applyMedicalExaminerVariant(DOCTOR_ITEMS, MANORS_ORGANIZATION_ID, EDRS_DISPLAY_STAGE, true);
    expect(labels(result)).toEqual([
      'Medical Examiner EDRS entry verified',
      'Medical Examiner cause of death verified',
      'Required ME information confirmed',
    ]);
  });

  it('gives the two sets DISJOINT indices, so neither can erase the other', () => {
    // The whole safety argument. checklistState is keyed by index, so
    // reusing 0-2 would make one stored key mean two different questions.
    const me = applyMedicalExaminerVariant(DOCTOR_ITEMS, MANORS_ORGANIZATION_ID, EDRS_DISPLAY_STAGE, true);
    expect(me.map((i) => i.index)).toEqual([3, 4, 5]);
    expect(DOCTOR_ITEMS.map((i) => i.index)).toEqual([0, 1, 2]);
    const overlap = me.filter((item) => DOCTOR_ITEMS.some((d) => d.index === item.index));
    expect(overlap).toEqual([]);
  });

  it('verification items require explicit staff action', () => {
    const result = applyMedicalExaminerVariant(DOCTOR_ITEMS, MANORS_ORGANIZATION_ID, EDRS_DISPLAY_STAGE, true);
    // No hasField and no requiredCaseFields: nothing about the case's data
    // can tick these, and classifying a case certainly cannot.
    for (const item of result) {
      expect(item.hasField).toBe(false);
      expect(item.requiredCaseFields).toBeUndefined();
    }
  });

  it('touches no other stage', () => {
    for (const displayStage of [0, 1, 3, 4, 5, 6]) {
      expect(applyMedicalExaminerVariant(DOCTOR_ITEMS, MANORS_ORGANIZATION_ID, displayStage, true)).toBe(DOCTOR_ITEMS);
    }
  });

  it('touches no other organization', () => {
    expect(applyMedicalExaminerVariant(DOCTOR_ITEMS, 'some-other-org', EDRS_DISPLAY_STAGE, true)).toBe(DOCTOR_ITEMS);
    expect(applyMedicalExaminerVariant(DOCTOR_ITEMS, null, EDRS_DISPLAY_STAGE, true)).toBe(DOCTOR_ITEMS);
  });

  it('swaps nothing if the template no longer holds the doctor items', () => {
    // Shape guard: the case shows too much rather than the wrong thing.
    const restructured = DOCTOR_ITEMS.map((item, position) =>
      position === 1 ? { ...item, label: 'Something else entirely' } : item,
    );
    expect(applyMedicalExaminerVariant(restructured, MANORS_ORGANIZATION_ID, EDRS_DISPLAY_STAGE, true)).toBe(
      restructured,
    );
  });

  it('keeps any unrelated item the stage carries', () => {
    const withExtra = [...DOCTOR_ITEMS, { index: 9, label: 'Something operational', hasField: false }];
    const result = applyMedicalExaminerVariant(withExtra, MANORS_ORGANIZATION_ID, EDRS_DISPLAY_STAGE, true);
    expect(labels(result)).toContain('Something operational');
    expect(labels(result)).not.toContain('Cause of death entered');
  });

  it('puts the verification items first — they are the stage\'s actual work', () => {
    const withExtra = [...DOCTOR_ITEMS, { index: 9, label: 'Something operational', hasField: false }];
    const result = applyMedicalExaminerVariant(withExtra, MANORS_ORGANIZATION_ID, EDRS_DISPLAY_STAGE, true);
    expect(result[0].label).toBe('Medical Examiner EDRS entry verified');
  });

  it('toggling back and forth is lossless — it only changes which set is presented', () => {
    const asMe = applyMedicalExaminerVariant(DOCTOR_ITEMS, MANORS_ORGANIZATION_ID, EDRS_DISPLAY_STAGE, true);
    const backToStandard = applyMedicalExaminerVariant(DOCTOR_ITEMS, MANORS_ORGANIZATION_ID, EDRS_DISPLAY_STAGE, false);
    expect(backToStandard).toBe(DOCTOR_ITEMS);
    // The ME items' own indices are unchanged by the round trip, so the
    // checklistState they were ticked under still resolves to them.
    expect(asMe.map((i) => i.index)).toEqual([3, 4, 5]);
  });
});

describe('medicalExaminerStageFor', () => {
  it('finds the configured stage, and nothing else', () => {
    expect(medicalExaminerStageFor(MANORS_ORGANIZATION_ID, EDRS_DISPLAY_STAGE)).not.toBeNull();
    expect(medicalExaminerStageFor(MANORS_ORGANIZATION_ID, 0)).toBeNull();
    expect(medicalExaminerStageFor('other-org', EDRS_DISPLAY_STAGE)).toBeNull();
    expect(medicalExaminerStageFor(undefined, EDRS_DISPLAY_STAGE)).toBeNull();
  });
});

describe('pendingMedicalExaminerPlaceholder', () => {
  it('describes a blank only on an ME case, and never invents a value', () => {
    expect(pendingMedicalExaminerPlaceholder(true)).toBe('Pending Medical Examiner');
    expect(pendingMedicalExaminerPlaceholder(false)).toBeNull();
  });
});
