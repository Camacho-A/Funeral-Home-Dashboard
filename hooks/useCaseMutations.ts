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
     * Case field editing / field-backed checklist sync (2026-09). Weight is
     * both a structured Case property (shown in CaseInformationCard) and a
     * field-backed First Call & Payment checklist item — editing only
     * Case.weight (the way updateCaseInfo's other structured fields work)
     * would leave that checklist item permanently "incomplete", since
     * resolveChecklist.ts's isFieldDone reads fieldValues[index], never
     * Case.weight directly. This writes both in the same patch, so the
     * checklist recognizes completion immediately without a second save —
     * and without ever touching checklistState or rawStage/currentStage
     * directly, which stay driven by the existing field-backed completion
     * logic exactly as they already are for every other field-backed item.
     *
     * The index is resolved from the case's own workflowSnapshot.intake
     * (findChecklistIndexForCaseField) rather than assumed — this is not a
     * Weight-specific special case, it works the same way for any
     * structured Case field an intake template maps to a checklist index
     * (Time of Death and the Hospice/physician contact fit this same
     * shape; wiring them through the UI is a deliberately separate,
     * later step, not a limitation of this function).
     */
    setWeight(case_: Case, value: string) {
      const patch: CaseUpdate = { weight: value };
      const index = case_.workflowSnapshot ? findChecklistIndexForCaseField(case_.workflowSnapshot.intake, 'weight') : null;
      if (index !== null) {
        patch.fieldValues = { ...case_.fieldValues, [index]: value };
      }
      updateCase.mutate(patch);
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
