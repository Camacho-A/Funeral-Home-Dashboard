import { useMutation, useQueryClient } from '@tanstack/react-query';
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

  const toggleTask = useMutation({
    mutationFn: ({ taskId, isDone }: { taskId: string; isDone: boolean }) =>
      tasksService.update(organization, taskId, { isDone }, organization.dataAdapterMode),
    onSuccess: invalidate,
  });

  return { ...tasksQuery, addTask: addTask.mutate, toggleTask: toggleTask.mutate };
}
