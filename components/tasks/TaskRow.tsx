import Link from 'next/link';
import { toDisplayName } from '@/utils/displayName';
import type { AssigneeStaff } from '@/domain/tasks/assignment';
import { TaskAssigneePicker } from './TaskAssigneePicker';

export type TaskRowItem = {
  id: string;
  text: string;
  isDone: boolean;
  /** StaffProfile id, or null for an unassigned task (2026-10). */
  assigneeStaffId: string | null;
  linkedCaseId: string | null;
  linkedCaseName: string | null;
};

/** What every row needs to show and change its assignee (2026-10). */
export type TaskAssignmentContext = {
  staff: readonly AssigneeStaff[];
  myStaffId: string | null;
  canAssign: boolean;
  onReassign: (taskId: string, assigneeStaffId: string | null) => void;
};

/**
 * SOLIS Tasks/Calendar/Settings phase, §1.4: a native checkbox, the task's
 * own text exactly as stored (ALL CAPS is the data standard), the linked
 * case, and the assignee. Task assignment (2026-10): the assignee is a
 * picker (reassign, unassign, "Assign to me") for staff with task.assign.
 * Same `onToggle`/`onRemove` handlers, unchanged.
 */
export function TaskRow({
  task,
  assignment,
  onToggle,
  onRemove,
}: {
  task: TaskRowItem;
  assignment: TaskAssignmentContext;
  onToggle: (newDone: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <div className="sx-task-row" data-done={task.isDone || undefined}>
      <input
        type="checkbox"
        className="sx-task-check"
        checked={task.isDone}
        onChange={() => onToggle(!task.isDone)}
        aria-label={task.text}
      />
      <span className="sx-task-text">
        {task.text}
        <span className="sr-only">{task.isDone ? ' (completed)' : ''}</span>
      </span>
      <span className="sx-task-meta">
        {task.linkedCaseName ? (
          <Link href={`/cases/${task.linkedCaseId}`} className="sx-task-case" title={toDisplayName(task.linkedCaseName)}>
            {toDisplayName(task.linkedCaseName)}
          </Link>
        ) : (
          <span />
        )}
        <TaskAssigneePicker
          taskLabel={task.text}
          assigneeStaffId={task.assigneeStaffId}
          staff={assignment.staff}
          myStaffId={assignment.myStaffId}
          canAssign={assignment.canAssign}
          showAssignToMe={!task.isDone}
          onChange={(assigneeStaffId) => assignment.onReassign(task.id, assigneeStaffId)}
        />
      </span>
      <button type="button" className="sx-icon-btn" aria-label={`Remove ${task.text}`} onClick={onRemove}>
        ×
      </button>
    </div>
  );
}
