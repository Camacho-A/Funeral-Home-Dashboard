import { describe, expect, it } from 'vitest';
import {
  applyMedicalExaminerVariant,
  medicalExaminerStageFor,
  pendingMedicalExaminerPlaceholder,
  MANORS_ORGANIZATION_ID,
} from './medicalExaminerWorkflow';
import type { ChecklistItemTemplate } from '../../types/workflowTemplate';

const EDRS_DISPLAY_STAGE = 2;
const INTAKE_DISPLAY_STAGE = 0;

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
  it('finds each configured stage, and nothing else', () => {
    expect(medicalExaminerStageFor(MANORS_ORGANIZATION_ID, EDRS_DISPLAY_STAGE)).not.toBeNull();
    expect(medicalExaminerStageFor(MANORS_ORGANIZATION_ID, INTAKE_DISPLAY_STAGE)).not.toBeNull();
    // Everything between and after them is untouched.
    for (const displayStage of [1, 3, 4, 5, 6]) {
      expect(medicalExaminerStageFor(MANORS_ORGANIZATION_ID, displayStage), String(displayStage)).toBeNull();
    }
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

/**
 * Intake on a Medical Examiner case (2026-10).
 *
 * Weight, Time of death and Certifier Information are all ME-owned, so
 * asking for them at step 1 stalls the case before the step where they
 * become obtainable — which is where B2026-037 sat with everything else
 * done and payment settled.
 */
describe('applyMedicalExaminerVariant — intake stage', () => {
  const INTAKE_ITEMS: ChecklistItemTemplate[] = [
    { index: 0, label: 'Name of deceased', hasField: true },
    { index: 3, label: 'Weight', hasField: true },
    { index: 4, label: 'Date of death', hasField: true },
    { index: 5, label: 'Time of death', hasField: true },
    { index: 6, label: 'Certifier Information', hasField: false },
    { index: 8, label: 'Payment collected', hasField: false },
  ];

  it('stops asking intake for what the Medical Examiner owes', () => {
    const result = applyMedicalExaminerVariant(INTAKE_ITEMS, MANORS_ORGANIZATION_ID, INTAKE_DISPLAY_STAGE, true);
    expect(labels(result)).not.toContain('Weight');
    expect(labels(result)).not.toContain('Time of death');
    expect(labels(result)).not.toContain('Certifier Information');
  });

  it('keeps every other intake item exactly as it was', () => {
    const result = applyMedicalExaminerVariant(INTAKE_ITEMS, MANORS_ORGANIZATION_ID, INTAKE_DISPLAY_STAGE, true);
    expect(labels(result)).toEqual(['Name of deceased', 'Date of death', 'Payment collected']);
    expect(result.map((i) => i.index)).toEqual([0, 4, 8]);
  });

  it('substitutes NOTHING — an ME case is simply not asked, never auto-answered', () => {
    // Marking them done would assert the funeral home obtained data it has
    // not got. Removing the question is honest; ticking it is not.
    const result = applyMedicalExaminerVariant(INTAKE_ITEMS, MANORS_ORGANIZATION_ID, INTAKE_DISPLAY_STAGE, true);
    expect(result).toHaveLength(3);
  });

  it('leaves a standard case completely untouched', () => {
    expect(applyMedicalExaminerVariant(INTAKE_ITEMS, MANORS_ORGANIZATION_ID, INTAKE_DISPLAY_STAGE, false)).toBe(
      INTAKE_ITEMS,
    );
  });

  it('accepts the pre-2026-09 certifier label too, so an older snapshot still matches', () => {
    const legacy = INTAKE_ITEMS.map((i) => (i.index === 6 ? { ...i, label: 'Certifier name & phone' } : i));
    const result = applyMedicalExaminerVariant(legacy, MANORS_ORGANIZATION_ID, INTAKE_DISPLAY_STAGE, true);
    expect(labels(result)).not.toContain('Certifier name & phone');
  });

  it('swaps nothing if the template no longer holds those items', () => {
    const restructured = INTAKE_ITEMS.map((i) => (i.index === 3 ? { ...i, label: 'Something else' } : i));
    expect(applyMedicalExaminerVariant(restructured, MANORS_ORGANIZATION_ID, INTAKE_DISPLAY_STAGE, true)).toBe(
      restructured,
    );
  });

  it('touches no other organization', () => {
    expect(applyMedicalExaminerVariant(INTAKE_ITEMS, 'some-other-org', INTAKE_DISPLAY_STAGE, true)).toBe(INTAKE_ITEMS);
  });

  it('un-classifying restores the questions — nothing was destroyed', () => {
    const asMe = applyMedicalExaminerVariant(INTAKE_ITEMS, MANORS_ORGANIZATION_ID, INTAKE_DISPLAY_STAGE, true);
    const back = applyMedicalExaminerVariant(INTAKE_ITEMS, MANORS_ORGANIZATION_ID, INTAKE_DISPLAY_STAGE, false);
    expect(asMe).toHaveLength(3);
    expect(back).toBe(INTAKE_ITEMS);
    expect(labels(back)).toContain('Certifier Information');
  });
});
