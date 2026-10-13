import type { ChecklistItemTemplate } from '../../types/workflowTemplate';

/**
 * Medical Examiner cases (2026-10).
 *
 * When the Medical Examiner handles a death, the ME holds the decedent,
 * determines the time of death, does the EDRS entry and certifies cause
 * of death. Funeral home staff do not repeat that work — they VERIFY it
 * happened, then carry on with the rest of the funeral home's own
 * workflow. Two stages therefore ask the wrong questions on an ME case:
 *
 *   Intake — Weight, Time of death and Certifier Information are all
 *     ME-owned. Asking for them at step 1 stalls the case before it can
 *     reach the step where they become obtainable. On an ME case they are
 *     not asked here at all, and nothing is substituted or marked done.
 *
 *   EDRS & Doctor / Cause of Death — the doctor items describe work the
 *     ME already did. Three verification items replace them.
 *
 * Neither variant invents data. What the ME owes is still captured in
 * Case Information (which shows "Pending Medical Examiner" in place of a
 * blank — see pendingMedicalExaminerPlaceholder), and "Required ME
 * information confirmed" at the EDRS stage is the gate that says it
 * arrived. The case waits at the step where the information can actually
 * be obtained, rather than at the one before it.
 *
 * NOTHING IS DELETED, IN EITHER DIRECTION. `Case.checklistState` is keyed
 * by the item's position (`"{displayStage}:{index}"`), so where a stage
 * substitutes items the two sets are given DISJOINT index ranges: the
 * standard doctor items keep 0-2, and the ME verification items occupy
 * 3-5, which the standard template never uses. Toggling the
 * classification swaps which set is rendered and counted; it never
 * rewrites, shifts or erases the other set's stored state. Tick the ME
 * items, switch back to a standard case, switch again — the ticks are
 * still there, and so are the standard items' own.
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

/** Where the Medical-Examiner-owned items live, and what they must say
    for the swap to apply. */
export type MedicalExaminerStageConfig = {
  displayStage: number;
  /** Indices replaced when the case is a Medical Examiner case. */
  replacedIndices: readonly number[];
  /** Each replaced index's expected label — the shape guard. A list of
      alternatives accepts any one of them, so a template that has since
      been relabelled still matches rather than silently opting out. */
  expectedLabels: readonly (string | readonly string[])[];
  /** The items shown instead, at indices the standard template never uses
      so neither set can overwrite the other. May be empty: an ME case can
      simply not be ASKED something, with nothing substituted. */
  verificationItems: readonly ChecklistItemTemplate[];
};

export const MEDICAL_EXAMINER_STAGES: Record<string, readonly MedicalExaminerStageConfig[]> = {
  [MANORS_ORGANIZATION_ID]: [
    /**
     * "First Call & Payment" — the intake stage (2026-10).
     *
     * On an ME case these three are not the funeral home's to answer. The
     * Medical Examiner holds the decedent, determines the time of death,
     * and IS the certifier; the weight is taken when the body is received
     * from them. Asking for all three at intake blocks the case at step 1
     * waiting on information that does not exist yet by definition —
     * which is exactly where B2026-037 (died at MEDICAL EXAMINERS DEPT)
     * sat, with payment settled and everything else done.
     *
     * Nothing is substituted here and nothing is marked done: the items
     * are simply not asked at intake. The data is still captured —
     * Case Information keeps every field editable and shows "Pending
     * Medical Examiner" in place of a blank (see
     * pendingMedicalExaminerPlaceholder) — and the EDRS stage's "Required
     * ME information confirmed" below is the gate that says the ME
     * supplied what was owed. So the case moves to the step where this
     * information is actually obtainable, instead of stalling before it.
     */
    {
      displayStage: 0,
      replacedIndices: [3, 5, 6],
      expectedLabels: [
        'Weight',
        'Time of death',
        // Both the current and the pre-2026-09 label, so an older frozen
        // snapshot still matches.
        ['Certifier Information', 'Certifier name & phone'],
      ],
      verificationItems: [],
    },
    /** "EDRS & Doctor / Cause of Death" — the ME did this work; staff
        verify it rather than repeat it. */
    {
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
  ],
};

/** Whether this organization has a Medical Examiner variant at all. */
export function medicalExaminerStageFor(
  organizationId: string | null | undefined,
  displayStage: number,
): MedicalExaminerStageConfig | null {
  const configs = organizationId ? MEDICAL_EXAMINER_STAGES[organizationId] : undefined;
  return configs?.find((config) => config.displayStage === displayStage) ?? null;
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
    if (!item) return false;
    const expected = config.expectedLabels[position];
    return typeof expected === 'string' ? item.label === expected : expected.includes(item.label);
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
