import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchManorsCutoverEligibility, executeManorsCutover } from '@/lib/caseNumberingClient';

/** Manors go-live case-number cutover (2026-09). Same query/mutation-hook
    shape as `hooks/useResources.ts`. */
const cutoverEligibilityKey = (organizationId: string) => ['manorsCutoverEligibility', organizationId];

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cutoverEligibilityKey(organizationId) }),
  });
}
