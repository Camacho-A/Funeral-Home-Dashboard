/**
 * The office-wide task list (Tasks screen), optionally linked to a case.
 * Matches docs/CMS_SCHEMA.md's CaseTasks collection.
 */
export type CaseTask = {
  id: string;
  organizationId: string;
  text: string;
  assigneeStaffId: string | null;
  isDone: boolean;
  caseId: string | null; // null = not linked to a case
  createdAt: string;
};

export type NewTaskInput = {
  text: string;
  assigneeStaffId: string | null;
  caseId?: string | null;
};

/**
 * The only fields a task update may touch — matches
 * services/tasksService.ts's update() signature exactly (already the
 * mock path's own allowlist, via TypeScript's Pick). `organizationId`,
 * `caseId`, `id`, and `createdAt` are deliberately excluded: `caseId` is
 * documented Immutable in docs/WIX_DATA_SCHEMA.md's Collection 6, and the
 * others are the same tenant/identity/immutability boundary every other
 * write in this project protects.
 */
export type TaskUpdate = Partial<Pick<CaseTask, 'isDone' | 'text' | 'assigneeStaffId'>>;
