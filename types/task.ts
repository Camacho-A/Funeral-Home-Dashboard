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
