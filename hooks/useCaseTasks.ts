import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { CaseTask } from '@/types/task';
import type { NewTaskInput } from '@/types/task';
import { tasksService } from '@/services/tasksService';
import { useTasks } from './useTasks';
import { useOrganization } from './useOrganization';

/**
 * Case-linked tasks for CaseTasksCard. Reuses useTasks({ caseId }) (Phase 4)
 * for the list rather than a separate query — this is exactly what that
 * hook's filter parameter was built for. Only the mutations (quick-add,
 * toggle) are new here.
 *
 * The prototype's quick-add defaults the assignee to the case owner (or the
 * first staff member if unowned) automatically, with no assignee picker in
 * the UI — see domain/tasks/rules.ts's defaultAssigneeForCase. Resolving
 * that default is the caller's job (the page, which already has the case
 * and staff list), not this hook's — addTask just takes a resolved
 * NewTaskInput.
 */
export function useCaseTasks(caseId: string) {
  const organization = useOrganization();
  const queryClient = useQueryClient();
  const tasksQuery = useTasks({ caseId });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['tasks', organization.organizationId] });
  }

  const addTask = useMutation({
    mutationFn: (input: NewTaskInput) =>
      tasksService.create(organization, { ...input, caseId }, organization.dataAdapterMode),
    onSuccess: invalidate,
  });

  /**
   * Phase 17 (Case Detail Experience): optimistic toggle so a checkbox
   * click reflects instantly instead of waiting on the PATCH round trip.
   * `setQueriesData` (not `setQueryData`) matches every cached ['tasks', ...]
   * query by prefix, so this also keeps the standalone Tasks page's cache
   * (a different filter shape, ['tasks', orgId, {}]) in sync if it happens
   * to be mounted at the same time — no authorization logic changes here;
   * the actual write still goes through the same tasksService.update ->
   * PATCH /api/tasks/[taskId], which is what re-verifies organizationId
   * server-side.
   */
  const toggleTask = useMutation({
    mutationFn: ({ taskId, isDone }: { taskId: string; isDone: boolean }) =>
      tasksService.update(organization, taskId, { isDone }, organization.dataAdapterMode),
    onMutate: async ({ taskId, isDone }) => {
      const queryFilter = { queryKey: ['tasks', organization.organizationId] };
      await queryClient.cancelQueries(queryFilter);

      const previousQueries = queryClient.getQueriesData<CaseTask[]>(queryFilter);
      queryClient.setQueriesData<CaseTask[]>(queryFilter, (old) =>
        old?.map((task) => (task.id === taskId ? { ...task, isDone } : task)),
      );

      return { previousQueries };
    },
    onError: (_error, _variables, context) => {
      context?.previousQueries.forEach(([queryKey, data]: [QueryKey, CaseTask[] | undefined]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    onSettled: invalidate,
  });

  return { ...tasksQuery, addTask: addTask.mutate, toggleTask: toggleTask.mutate };
}
