import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchManorsCutoverEligibility,
  executeManorsCutover,
  fetchCaseSequenceResyncPlan,
  executeCaseSequenceResync,
} from '@/lib/caseNumberingClient';

/** Manors go-live case-number cutover (2026-09). Same query/mutation-hook
    shape as `hooks/useResources.ts`. */
const cutoverEligibilityKey = (organizationId: string) => ['manorsCutoverEligibility', organizationId];
const resyncPlanKey = (organizationId: string) => ['caseSequenceResyncPlan', organizationId];

export function useManorsCutoverEligibility(organizationId: string) {
  return useQuery({
    queryKey: cutoverEligibilityKey(organizationId),
    queryFn: () => fetchManorsCutoverEligibility(organizationId),
    enabled: Boolean(organizationId),
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
    queryFn: () => fetchCaseSequenceResyncPlan(organizationId),
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
