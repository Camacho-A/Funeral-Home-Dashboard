import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { CaseTask } from '@/types/task';
import { tasksService } from '@/services/tasksService';
import { useOrganization } from './useOrganization';

/**
 * Assign, reassign or unassign a task (2026-10) — from the Tasks page or a
 * case's task card. Optimistic like useCaseTasks' toggle: every cached
 * ['tasks', orgId, …] list shows the new assignee at once and is rolled
 * back if the server refuses (the server re-checks organization
 * membership, the assignee's staff profile and the task.assign
 * permission).
 */
export function useReassignTask() {
  const organization = useOrganization();
  const queryClient = useQueryClient();
  const queryFilter = { queryKey: ['tasks', organization.organizationId] };

  return useMutation({
    mutationFn: ({ taskId, assigneeStaffId }: { taskId: string; assigneeStaffId: string | null }) =>
      tasksService.update(organization, taskId, { assigneeStaffId }, organization.dataAdapterMode),
    onMutate: async ({ taskId, assigneeStaffId }) => {
      await queryClient.cancelQueries(queryFilter);
      const previousQueries = queryClient.getQueriesData<CaseTask[]>(queryFilter);
      queryClient.setQueriesData<CaseTask[]>(queryFilter, (old) => old?.map((task) => (task.id === taskId ? { ...task, assigneeStaffId } : task)));
      return { previousQueries };
    },
    onError: (_error, _variables, context) => {
      context?.previousQueries.forEach(([queryKey, data]: [QueryKey, CaseTask[] | undefined]) => queryClient.setQueryData(queryKey, data));
    },
    onSettled: () => queryClient.invalidateQueries(queryFilter),
  });
}
