import type { OrganizationContext } from '../types/organization';
import type { CaseTask, NewTaskInput } from '../types/task';
import type { DataAdapterMode } from '../lib/env';
import { taskFixtures } from './__mocks__/fixtures';

export type TaskFilters = {
  caseId?: string;
};

/**
 * Phase 15D (Wix Task Read Integration): list() gained a `dataAdapterMode`
 * parameter (see docs/adr/ADR-014), read from useOrganization()'s
 * server-resolved value, never from a client-side env var read — the
 * exact same pattern Phase 15C established for casesService.list()/get(),
 * necessary for the same reason: this function shares `taskFixtures` with
 * create()/update()/remove() below, which are entirely untouched and
 * remain mock-only regardless of this parameter. When "mock" (the
 * default), this runs the *exact same* fixture-filtering code that ran
 * here before this phase.
 */
export async function list(
  context: OrganizationContext,
  filters: TaskFilters = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<CaseTask[]> {
  if (dataAdapterMode === 'mock') {
    return taskFixtures.filter(
      (t) =>
        t.organizationId === context.organizationId &&
        (filters.caseId === undefined || t.caseId === filters.caseId),
    );
  }

  const params = new URLSearchParams({ organizationId: context.organizationId });
  if (filters.caseId !== undefined) params.set('caseId', filters.caseId);

  const response = await fetch(`/api/tasks?${params.toString()}`);
  if (!response.ok) {
    throw new Error('Failed to load tasks.');
  }
  const body = (await response.json()) as { tasks: CaseTask[] };
  return body.tasks;
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
