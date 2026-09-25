import { useMutation, useQueryClient } from '@tanstack/react-query';
import { recalculateCaseWorkflow } from '@/lib/caseWorkflowRepairClient';

/** Case repair UI (2026-09) — "Recalculate Workflow." On success,
    invalidates the case query itself (the sole source `useCaseViewModel`
    derives stage/checklist/progress from) so Case Detail immediately
    reflects the corrected current stage. */
export function useRecalculateCaseWorkflow(organizationId: string, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => recalculateCaseWorkflow(organizationId, caseId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', organizationId, caseId] }),
  });
}
