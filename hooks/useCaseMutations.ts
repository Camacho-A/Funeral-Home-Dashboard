import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Case, CaseUpdate, VaPublishChoice } from '@/types/case';
import { casesService } from '@/services/casesService';
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

    setVeteranFlag(newValue: boolean) {
      updateCase.mutate({ isVeteran: newValue });
    },

    toggleVaStep(case_: Case, index: number, newDone: boolean) {
      updateCase.mutate({ vaStepsState: { ...case_.vaStepsState, [index]: newDone } });
    },

    setVaPublishChoice(choice: VaPublishChoice) {
      updateCase.mutate({ vaPublishChoice: choice });
    },
  };
}
