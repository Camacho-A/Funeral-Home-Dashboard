import type { OrganizationContext } from '../types/organization';
import type { CaseTask, NewTaskInput } from '../types/task';
import { taskFixtures } from './__mocks__/fixtures';

export type TaskFilters = {
  caseId?: string;
};

export async function list(
  context: OrganizationContext,
  filters: TaskFilters = {},
): Promise<CaseTask[]> {
  return taskFixtures.filter(
    (t) =>
      t.organizationId === context.organizationId &&
      (filters.caseId === undefined || t.caseId === filters.caseId),
  );
}

export async function create(context: OrganizationContext, input: NewTaskInput): Promise<CaseTask> {
  const newTask: CaseTask = {
    id: `task-${taskFixtures.length + 1}`,
    organizationId: context.organizationId,
    text: input.text,
    assigneeStaffId: input.assigneeStaffId,
    isDone: false,
    caseId: input.caseId ?? null,
    createdAt: new Date().toISOString(),
  };
  taskFixtures.push(newTask);
  return newTask;
}

export async function update(
  context: OrganizationContext,
  taskId: string,
  patch: Partial<Pick<CaseTask, 'isDone' | 'text' | 'assigneeStaffId'>>,
): Promise<CaseTask> {
  const index = taskFixtures.findIndex(
    (t) => t.id === taskId && t.organizationId === context.organizationId,
  );
  if (index === -1) throw new Error(`Task ${taskId} not found for this organization`);
  const updated = { ...taskFixtures[index], ...patch };
  taskFixtures[index] = updated;
  return updated;
}

export async function remove(context: OrganizationContext, taskId: string): Promise<void> {
  const index = taskFixtures.findIndex(
    (t) => t.id === taskId && t.organizationId === context.organizationId,
  );
  if (index === -1) return;
  taskFixtures.splice(index, 1);
}

export const tasksService = { list, create, update, remove };
