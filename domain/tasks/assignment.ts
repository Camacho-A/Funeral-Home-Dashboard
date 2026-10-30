import type { CaseTask } from '../../types/task';

/**
 * Task assignment (2026-10) — who a task belongs to, as staff see it.
 *
 * `assigneeStaffId` is a StaffProfile id (never an identity id). Null is a
 * real, supported state — "Unassigned" — not a stand-in for the office;
 * the old "Office" fallback hid both unassigned tasks and staff whose
 * names failed to load. An id that is not among the active staff (a
 * deactivated profile) is still shown as assigned, never as unassigned.
 */

export type AssigneeStaff = { id: string; name: string };

export type TaskAssigneeDisplay =
  | { kind: 'unassigned'; name: 'Unassigned'; staffId: null }
  | { kind: 'staff'; name: string; staffId: string }
  | { kind: 'unknown'; name: 'Former staff member'; staffId: string };

export function taskAssigneeDisplay(assigneeStaffId: string | null, staff: readonly AssigneeStaff[]): TaskAssigneeDisplay {
  if (!assigneeStaffId) return { kind: 'unassigned', name: 'Unassigned', staffId: null };
  const match = staff.find((s) => s.id === assigneeStaffId);
  return match ? { kind: 'staff', name: match.name, staffId: match.id } : { kind: 'unknown', name: 'Former staff member', staffId: assigneeStaffId };
}

export type TaskView = 'all' | 'mine';

/** The Tasks page view, as kept in the URL (`?view=mine`). Anything else is "All tasks". */
export function parseTaskView(value: string | null | undefined): TaskView {
  return value === 'mine' ? 'mine' : 'all';
}

/**
 * "Assigned to me" — tasks whose assignee is the caller's own staff
 * profile. A caller with no staff profile yet has no tasks of their own.
 */
export function filterTasksForView<T extends Pick<CaseTask, 'assigneeStaffId'>>(tasks: readonly T[], view: TaskView, myStaffId: string | null): T[] {
  if (view === 'all') return [...tasks];
  if (!myStaffId) return [];
  return tasks.filter((task) => task.assigneeStaffId === myStaffId);
}
