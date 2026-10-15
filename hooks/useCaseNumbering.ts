import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchManorsCutoverEligibility,
  executeManorsCutover,
  fetchCaseSequenceResyncPlan,
  executeCaseSequenceResync,
  type CaseSequenceResyncPlan,
} from '@/lib/caseNumberingClient';

/** The one organization the one-time go-live cutover applies to — the
    route itself hard-gates on the same id. Every other organization
    (e.g. Gus Camacho) never queries the cutover endpoint and never sees
    its Manors-specific wording. */
export const MANORS_CUTOVER_ORGANIZATION_ID = 'managed-cremations';

export function isManorsCutoverOrganization(organizationId: string): boolean {
  return organizationId === MANORS_CUTOVER_ORGANIZATION_ID;
}

/** Organization-specific numbering (2026-10): the resync GET also reports
    the organization's own prefix and the number the next new case will
    receive (see app/api/organization/case-sequence/resync/route.ts). */
export type CaseNumberingPlan = CaseSequenceResyncPlan & {
  caseNumberPrefix?: string;
  nextCaseNumber?: string;
};

/** Manors go-live case-number cutover (2026-09). Same query/mutation-hook
    shape as `hooks/useResources.ts`. */
const cutoverEligibilityKey = (organizationId: string) => ['manorsCutoverEligibility', organizationId];
const resyncPlanKey = (organizationId: string) => ['caseSequenceResyncPlan', organizationId];

export function useManorsCutoverEligibility(organizationId: string) {
  return useQuery({
    queryKey: cutoverEligibilityKey(organizationId),
    queryFn: () => fetchManorsCutoverEligibility(organizationId),
    // Never even queried for an organization the cutover cannot apply to.
    enabled: Boolean(organizationId) && isManorsCutoverOrganization(organizationId),
  });
}

export function useExecuteManorsCutover(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => executeManorsCutover(organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cutoverEligibilityKey(organizationId) });
      queryClient.invalidateQueries({ queryKey: resyncPlanKey(organizationId) });
    },
  });
}

/** Case-number sequence resync (2026-10). */
export function useCaseSequenceResyncPlan(organizationId: string) {
  return useQuery({
    queryKey: resyncPlanKey(organizationId),
    queryFn: async (): Promise<CaseNumberingPlan> => fetchCaseSequenceResyncPlan(organizationId),
    enabled: Boolean(organizationId),
  });
}

export function useExecuteCaseSequenceResync(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => executeCaseSequenceResync(organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: resyncPlanKey(organizationId) });
      queryClient.invalidateQueries({ queryKey: cutoverEligibilityKey(organizationId) });
    },
  });
}
