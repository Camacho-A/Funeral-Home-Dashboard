/**
 * Manors intake-stage combination (2026-10). A PRESENTATION-ONLY overlay
 * that renders two adjacent canonical display stages as one user-facing
 * stage, so Manors' operational workflow reads as six stages instead of
 * seven:
 *
 *   1. Intake & JotForm              <- canonical display stages 0 AND 1
 *   2. EDRS & Doctor / Cause of Death
 *   3. Permit & Authorization Sent to Crematory
 *   4. DC Application Sent
 *   5. Ready for Pickup / Contact Family
 *   6. Completed
 *
 * Nothing here is persisted and nothing here is authoritative. Every
 * stored value keeps its canonical meaning: `Case.rawStage`, each
 * `StageTemplate.displayStage`, every `checklistState` composite key, and
 * every historical Activity/Audit label are untouched. This module only
 * decides what a human is shown.
 *
 * WHY A PRESENTATION LAYER AND NOT A TEMPLATE CHANGE
 *
 * The obvious-looking alternative — publish a template version that moves
 * "Jotform Application" onto `displayStage: 0` alongside First Call — is
 * unsafe, and this was confirmed against live data rather than assumed.
 * `checklistState` keys are `"{displayStage}:{index}"` (see
 * domain/workflow/checklistItemKey.ts for the collision incident that
 * established that shape). A real Manors case already carries the key
 * `"1:0"` — its completed "Jotform application completed" item. Remapping
 * that stage to display 0 would reinterpret `"1:0"` as `"0:0"`, which in
 * the First Call checklist means "Name of deceased". That is precisely the
 * cross-stage completion collision the composite-key fix exists to
 * prevent, and it would silently corrupt completion state on existing
 * cases.
 *
 * A template change also could not deliver consistent presentation at all:
 * a case's `workflowSnapshot` is frozen at creation and never reassigned,
 * so existing cases would keep rendering seven stages while new ones
 * rendered six. An overlay applies uniformly to every case regardless of
 * which template version it was created from.
 *
 * SCOPING
 *
 * Keyed on the stable `organizationId`, never a mutable display name, and
 * guarded by a shape check: the combination applies only when the
 * canonical labels actually are the two historical Manors intake stages,
 * in the expected order. If Manors' template is ever restructured, this
 * overlay stops applying rather than mislabelling a stage it no longer
 * understands. Every other organization — including Gus Camacho Jr.
 * Funeral Home — gets the identity mapping, one presented stage per
 * canonical display stage, and is entirely unaffected.
 */

/** Stable organization identifier — matches the same constant pattern
    already used by domain/organization/moduleVisibility.ts and
    caseOrderTerminology.ts rather than string-matching a display name. */
const MANORS_ORGANIZATION_ID = 'managed-cremations';

/** The two canonical display-stage labels this overlay combines. Matched
    exactly, so a restructured template is left alone. */
const FIRST_CALL_LABEL = 'First Call & Payment';
const JOTFORM_APPLICATION_LABEL = 'Jotform Application';

/** The combined user-facing label. "Payment" is deliberately dropped from
    the NAME only — every payment checklist item, record, balance, and API
    is untouched (payment removal is a separate, later phase). */
export const COMBINED_INTAKE_LABEL = 'Intake & JotForm';

/**
 * One user-facing stage. `canonicalDisplayStages` is always non-empty and
 * ascending; for every organization except Manors it holds exactly one
 * entry, making the mapping an identity.
 */
export type PresentedStage = {
  label: string;
  canonicalDisplayStages: number[];
};

function combinesIntakeStages(organizationId: string, canonicalLabels: readonly string[]): boolean {
  return (
    organizationId === MANORS_ORGANIZATION_ID &&
    canonicalLabels[0] === FIRST_CALL_LABEL &&
    canonicalLabels[1] === JOTFORM_APPLICATION_LABEL
  );
}

/**
 * The user-facing stage list for one organization, derived from that
 * organization's own canonical display-stage labels (the case's snapshot
 * on Case Detail, or domain/cases/stages.ts#STAGES on the shared
 * Dashboard/Cases surfaces). Never invents, reorders, or drops a stage —
 * it only merges the two historical Manors intake stages into one entry.
 */
export function presentedStages(organizationId: string, canonicalLabels: readonly string[]): PresentedStage[] {
  if (!combinesIntakeStages(organizationId, canonicalLabels)) {
    return canonicalLabels.map((label, displayStage) => ({ label, canonicalDisplayStages: [displayStage] }));
  }

  const combined: PresentedStage = { label: COMBINED_INTAKE_LABEL, canonicalDisplayStages: [0, 1] };
  const rest = canonicalLabels
    .slice(2)
    .map((label, offset) => ({ label, canonicalDisplayStages: [offset + 2] }));
  return [combined, ...rest];
}

/** Just the labels — the common case for a stepper or a filter dropdown. */
export function presentedStageLabels(organizationId: string, canonicalLabels: readonly string[]): string[] {
  return presentedStages(organizationId, canonicalLabels).map((stage) => stage.label);
}

/**
 * Which user-facing position a canonical display stage renders at. Both
 * canonical intake stages collapse onto index 0 for Manors; every later
 * stage shifts down by one. An out-of-range input is returned unchanged,
 * so a malformed stage can never throw here.
 */
export function toPresentedStageIndex(
  organizationId: string,
  canonicalDisplayStage: number,
  canonicalLabels: readonly string[],
): number {
  if (!combinesIntakeStages(organizationId, canonicalLabels)) return canonicalDisplayStage;
  return canonicalDisplayStage <= 1 ? 0 : canonicalDisplayStage - 1;
}

/**
 * The canonical display stage whose checklist a user-facing stage should
 * open when inspected.
 *
 * For a presented stage covering a single canonical stage this is simply
 * that stage. For Manors' combined intake stage it resolves to the case's
 * OWN current canonical stage when the case currently sits inside the
 * group — so a case in "Jotform Application" opens the Jotform item,
 * which is genuinely its live checklist — and otherwise to the group's
 * first canonical stage (First Call), which carries the eleven
 * substantive intake items. This keeps `viewingDisplayStage` a canonical
 * value everywhere, so checklist lookup and composite-key reads are
 * completely unchanged.
 */
export function canonicalDisplayStageToInspect(
  organizationId: string,
  presentedIndex: number,
  currentCanonicalDisplayStage: number,
  canonicalLabels: readonly string[],
): number {
  const stages = presentedStages(organizationId, canonicalLabels);
  const presented = stages[presentedIndex];
  if (!presented) return presentedIndex;
  if (presented.canonicalDisplayStages.includes(currentCanonicalDisplayStage)) {
    return currentCanonicalDisplayStage;
  }
  return presented.canonicalDisplayStages[0];
}

/**
 * Resolves a user-facing stage label to the canonical display stages it
 * covers, or `null` when the label is not one of this organization's
 * presented stages.
 *
 * Deliberately also accepts a canonical label that the overlay has
 * merged away ("First Call & Payment", "Jotform Application"), returning
 * just that one canonical stage — so an existing bookmark, saved filter,
 * or API caller using the historical label keeps working exactly as
 * before. Backward compatibility, not a fallback for bad input.
 */
export function canonicalDisplayStagesForPresentedLabel(
  organizationId: string,
  label: string,
  canonicalLabels: readonly string[],
): number[] | null {
  const presented = presentedStages(organizationId, canonicalLabels).find((stage) => stage.label === label);
  if (presented) return [...presented.canonicalDisplayStages];

  const canonicalIndex = canonicalLabels.indexOf(label);
  return canonicalIndex === -1 ? null : [canonicalIndex];
}
