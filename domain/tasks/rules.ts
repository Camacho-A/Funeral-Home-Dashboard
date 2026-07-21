import type { Case } from '../../types/case';
import type { StaffProfile } from '../../types/staffProfile';

/**
 * When quick-adding a task from an unowned case, design/support.js's
 * addCaseTask() defaults the assignee to the *first staff member in the
 * list*, not "Office" — a different fallback than the one used for the
 * case log's author field (see domain/cases/timeline.ts, built in Phase 4;
 * the case log itself is a Phase 6 concern). Preserved here as its own
 * named rule rather than assumed to match the log's convention.
 */
export function defaultAssigneeForCase(case_: Case, staffList: StaffProfile[]): string | null {
  if (case_.assignedStaffId) return case_.assignedStaffId;
  return staffList[0]?.id ?? null;
}
