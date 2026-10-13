import type { ChecklistItemTemplate } from '../../types/workflowTemplate';

/**
 * Medical Examiner cases (2026-10).
 *
 * When the Medical Examiner handles a death, the ME does the EDRS entry
 * and certifies cause of death. Funeral home staff do not repeat that
 * work — they VERIFY it happened, then carry on with the rest of the
 * funeral home's own workflow. So the doctor-specific items in the
 * "EDRS & Doctor / Cause of Death" stage are the wrong question to ask,
 * and three verification items are the right one.
 *
 * NOTHING IS DELETED, IN EITHER DIRECTION. `Case.checklistState` is keyed
 * by the item's position (`"{displayStage}:{index}"`), so the two sets of
 * items are given DISJOINT index ranges in the same stage: the standard
 * doctor items keep 0-2, and the ME verification items occupy 3-5, which
 * the standard template never uses. Toggling the classification swaps
 * which set is rendered and counted; it never rewrites, shifts or erases
 * the other set's stored state. Tick the ME items, switch back to a
 * standard case, switch again — the ticks are still there.
 *
 * That disjoint-range choice is the whole safety argument. Reusing 0-2
 * for the ME items would make "2:0" mean "EDRS submitted & sent to
 * doctor" on one case and "Medical Examiner EDRS entry verified" on
 * another — exactly the ambiguity the composite-key fix was introduced to
 * end.
 *
 * SCOPING. Keyed on the stable `organizationId`, like
 * checklistRetirement.ts and cremainsPickupCapability.ts, so no other
 * tenant is affected. Guarded by a label SHAPE CHECK: if a template is
 * ever restructured so those indices no longer hold the doctor items,
 * nothing is swapped and the standard stage renders untouched — the case
 * shows too much rather than the wrong thing.
 */

export const MANORS_ORGANIZATION_ID = 'managed-cremations';

/** Where the doctor-specific items live, and what they must say for the
    swap to apply. */
export type MedicalExaminerStageConfig = {
  displayStage: number;
  /** Indices replaced when the case is a Medical Examiner case. */
  replacedIndices: readonly number[];
  /** Each replaced index's expected label — the shape guard. */
  expectedLabels: readonly string[];
  /** The verification items shown instead, at indices the standard
      template never uses so neither set can overwrite the other. */
  verificationItems: readonly ChecklistItemTemplate[];
};

export const MEDICAL_EXAMINER_STAGES: Record<string, MedicalExaminerStageConfig> = {
  [MANORS_ORGANIZATION_ID]: {
    // "EDRS & Doctor / Cause of Death".
    displayStage: 2,
    replacedIndices: [0, 1, 2],
    expectedLabels: [
      'EDRS submitted & sent to doctor',
      'Cause of death entered',
      'Hardsave for state approval if not an online doctor',
    ],
    verificationItems: [
      { index: 3, label: 'Medical Examiner EDRS entry verified', hasField: false },
      { index: 4, label: 'Medical Examiner cause of death verified', hasField: false },
      { index: 5, label: 'Required ME information confirmed', hasField: false },
    ],
  },
};

/** Whether this organization has a Medical Examiner variant at all. */
export function medicalExaminerStageFor(
  organizationId: string | null | undefined,
  displayStage: number,
): MedicalExaminerStageConfig | null {
  const config = organizationId ? MEDICAL_EXAMINER_STAGES[organizationId] : undefined;
  if (!config || config.displayStage !== displayStage) return null;
  return config;
}

/**
 * The items a stage should actually present for this case.
 *
 * For a standard case, or any stage/organization with no ME variant, this
 * returns the template's own items completely untouched — the standard
 * workflow is not routed through any new logic.
 *
 * The returned items keep their ORIGINAL `index`, which is what every
 * stored `checklistState` key resolves against.
 */
export function applyMedicalExaminerVariant(
  items: ChecklistItemTemplate[],
  organizationId: string | null | undefined,
  displayStage: number,
  isMedicalExaminerCase: boolean,
): ChecklistItemTemplate[] {
  if (!isMedicalExaminerCase) return items;

  const config = medicalExaminerStageFor(organizationId, displayStage);
  if (!config) return items;

  // Shape guard: only swap the items genuinely there.
  const matches = config.replacedIndices.every((index, position) => {
    const item = items.find((candidate) => candidate.index === index);
    return item?.label === config.expectedLabels[position];
  });
  if (!matches) return items;

  const replaced = new Set(config.replacedIndices);
  const kept = items.filter((item) => !replaced.has(item.index));

  // Verification items first: on an ME case they are the stage's actual
  // work, and burying them under whatever else the stage carries would
  // make staff hunt for the thing they are there to do.
  return [...config.verificationItems, ...kept];
}

/**
 * Whether a blank value on this case should read "Pending Medical
 * Examiner" rather than as simply absent.
 *
 * Display only, and deliberately so: a value SOLIS does not have is not
 * invented, back-filled, or treated as present. This changes how an empty
 * field is described, never what is stored.
 */
export const PENDING_MEDICAL_EXAMINER_LABEL = 'Pending Medical Examiner';

export function pendingMedicalExaminerPlaceholder(isMedicalExaminerCase: boolean): string | null {
  return isMedicalExaminerCase ? PENDING_MEDICAL_EXAMINER_LABEL : null;
}
