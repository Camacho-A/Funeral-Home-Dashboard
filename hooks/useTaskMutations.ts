import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NewTaskInput } from '@/types/task';
import { tasksService } from '@/services/tasksService';
import { useOrganization } from './useOrganization';

/**
 * Global Tasks page mutations (add/toggle/remove) — paired with useTasks()
 * for the list, the same split useCase/useCaseMutations uses on Case
 * Detail. Distinct from useCaseTasks (Phase 6), which bundles a
 * case-scoped list with its own mutations for the Case Detail screen.
 */
export function useTaskMutations() {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['tasks', organization.organizationId] });
  }

  const addTask = useMutation({
    mutationFn: (input: NewTaskInput) => tasksService.create(organization, input),
    onSuccess: invalidate,
  });

  const toggleTask = useMutation({
    mutationFn: ({ taskId, isDone }: { taskId: string; isDone: boolean }) =>
      tasksService.update(organization, taskId, { isDone }),
    onSuccess: invalidate,
  });

  const removeTask = useMutation({
    mutationFn: (taskId: string) => tasksService.remove(organization, taskId),
    onSuccess: invalidate,
  });

  return {
    addTask: addTask.mutate,
    toggleTask: toggleTask.mutate,
    removeTask: removeTask.mutate,
  };
}
