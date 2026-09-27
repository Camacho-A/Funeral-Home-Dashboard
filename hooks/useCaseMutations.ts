import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Case, CaseUpdate, VaPublishChoice, VaNotificationResponsibility } from '@/types/case';
import { casesService } from '@/services/casesService';
import { findChecklistIndexForCaseField } from '@/domain/workflow/resolveIntake';
import { useOrganization } from './useOrganization';

/**
 * The Case Detail mutations the Frontend Engineering Plan's Hooks section
 * anticipated for Phase 6 (owner reassignment, checklist toggles, veteran
 * flags, ...) — distinct from useAdvanceCaseStage (Phase 5, the Dashboard's
 * bulk-advance action). Every function computes a small patch and calls
 * casesService.update through one shared mutation; callers pass the current
 * `Case` only where a patch needs to spread an existing map
 * (checklistState/fieldValues/vaStepsState) rather than replace it outright.
 */

/**
 * Builds the combined `{ [caseField]: value, fieldValues }` patch shared by
 * every structured-Case-field-that's-also-a-field-backed-checklist-item
 * mutator (setWeight, setTimeOfDeath, ...) — see setWeight's own comment
 * for why both must be written in the same patch. A plain function
 * (rather than a `this`-using object method) so it stays a safe, ordinary
 * call regardless of how a caller invokes the returned mutations object.
 */
function buildStructuredIntakeFieldPatch<K extends keyof CaseUpdate & string>(
  case_: Case,
  caseField: K,
  value: string | null,
): CaseUpdate {
  const patch: CaseUpdate = { [caseField]: value } as CaseUpdate;
  const index = case_.workflowSnapshot ? findChecklistIndexForCaseField(case_.workflowSnapshot.intake, caseField) : null;
  if (index !== null) {
    // Weight/Time of Death (the only callers with a real checklistItemIndex
    // today) always pass a non-null string — the `?? ''` only matters for a
    // hypothetical future nullable field-backed item, never for the
    // Certifier fields below (which deliberately have no checklistItemIndex
    // at all, so this branch never runs for them regardless of value).
    patch.fieldValues = { ...case_.fieldValues, [index]: value ?? '' };
  }
  return patch;
}

export function useCaseMutations(caseId: string) {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  const updateCase = useMutation({
    mutationFn: (patch: Parameters<typeof casesService.update>[2]) =>
      casesService.update(organization, caseId, patch, organization.dataAdapterMode),
    onSuccess: (updated) => {
      queryClient.setQueryData(['case', organization.organizationId, caseId], updated);
      queryClient.invalidateQueries({ queryKey: ['cases', organization.organizationId] });
    },
  });

  return {
    isPending: updateCase.isPending,

    toggleChecklistItem(case_: Case, index: number, newDone: boolean) {
      updateCase.mutate({ checklistState: { ...case_.checklistState, [index]: newDone } });
    },

    setFieldValue(case_: Case, index: number, value: string) {
      updateCase.mutate({ fieldValues: { ...case_.fieldValues, [index]: value } });
    },

    reassignOwner(staffId: string | null) {
      updateCase.mutate({ assignedStaffId: staffId });
    },

    /**
     * Phase 17 (Case Detail Experience): the single generic entry point for
     * CaseInformationCard's inline-editable fields (dates, location, next of
     * kin, payment status, ...). No new update logic — it's the exact same
     * updateCase mutation every other method here already uses, which
     * already branches on dataAdapterMode to hit the real Wix PATCH route;
     * this method just exists so the component doesn't need one
     * differently-named mutator per field.
     */
    updateCaseInfo(patch: CaseUpdate) {
      updateCase.mutate(patch);
    },

    /**
     * Case field editing / field-backed checklist sync (2026-09). Weight,
     * and now Time of Death, are both structured Case properties (shown in
     * CaseInformationCard) that are *also* field-backed First Call &
     * Payment checklist items — editing only Case.<field> (the way
     * updateCaseInfo's other structured fields work) would leave that
     * checklist item permanently "incomplete", since resolveChecklist.ts's
     * isFieldDone reads fieldValues[index], never the structured Case
     * property directly. This writes both in the same patch, so the
     * checklist recognizes completion immediately without a second save —
     * and without ever touching checklistState or rawStage/currentStage
     * directly, which stay driven by the existing field-backed completion
     * logic exactly as they already are for every other field-backed item.
     *
     * The index is resolved from the case's own workflowSnapshot.intake
     * (findChecklistIndexForCaseField) rather than assumed — this is a
     * generic mechanism, not a per-field special case; it works the same
     * way for any structured Case field an intake template maps to a
     * checklist index (the Hospice/physician contact fits this same shape;
     * wiring it through the UI is a deliberately separate, later step, not
     * a limitation of this function).
     */
    setWeight(case_: Case, value: string) {
      updateCase.mutate(buildStructuredIntakeFieldPatch(case_, 'weight', value));
    },

    setTimeOfDeath(case_: Case, value: string) {
      updateCase.mutate(buildStructuredIntakeFieldPatch(case_, 'timeOfDeath', value));
    },

    /**
     * Structured Certifier data (2026-09, ADR-041). Unlike Weight/Time of
     * Death, the v5 intake template deliberately gives none of the four
     * certifier fields a checklistItemIndex — buildStructuredIntakeFieldPatch
     * still handles that correctly with zero changes (findChecklistIndexForCaseField
     * resolves null, so the returned patch is just `{ certifierX: value }`,
     * never touching fieldValues). The "Certifier Information" checklist
     * item's own completion comes from requiredCaseFields
     * (domain/workflow/resolveChecklist.ts), reading these structured
     * fields directly.
     */
    setCertifierName(case_: Case, value: string | null) {
      updateCase.mutate(buildStructuredIntakeFieldPatch(case_, 'certifierName', value));
    },

    setCertifierPhone(case_: Case, value: string | null) {
      updateCase.mutate(buildStructuredIntakeFieldPatch(case_, 'certifierPhone', value));
    },

    setCertifierLicenseNumber(case_: Case, value: string | null) {
      updateCase.mutate(buildStructuredIntakeFieldPatch(case_, 'certifierLicenseNumber', value));
    },

    setCertifierFax(case_: Case, value: string | null) {
      updateCase.mutate(buildStructuredIntakeFieldPatch(case_, 'certifierFax', value));
    },

    setVeteranFlag(newValue: boolean) {
      updateCase.mutate({ isVeteran: newValue });
    },

    toggleVaStep(case_: Case, index: number, newDone: boolean) {
      updateCase.mutate({ vaStepsState: { ...case_.vaStepsState, [index]: newDone } });
    },

    setVaPublishChoice(choice: VaPublishChoice) {
      updateCase.mutate({ vaPublishChoice: choice });
    },

    /** VA responsibility correction (2026-09) — independent of
        setVeteranFlag; never implies/changes isVeteran. */
    setVaNotificationResponsibility(responsibility: VaNotificationResponsibility) {
      updateCase.mutate({ vaNotificationResponsibility: responsibility });
    },
  };
}
