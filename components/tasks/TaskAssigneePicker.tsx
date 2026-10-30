'use client';

import { taskAssigneeDisplay, type AssigneeStaff } from '@/domain/tasks/assignment';

/** First letters of the first two words, uppercase. */
export function assigneeInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Who a task belongs to (2026-10) — Jira-style: the avatar and name, and,
 * for staff allowed to assign, a compact native select to reassign or
 * unassign plus a one-click "Assign to me" when the task isn't yours.
 * A native <select> keeps it keyboard- and screen-reader-friendly and
 * gives phones their own picker. Without the task.assign permission the
 * name is shown read-only (the server enforces the same rule).
 */
export function TaskAssigneePicker({
  taskLabel,
  assigneeStaffId,
  staff,
  myStaffId,
  canAssign,
  disabled = false,
  showAssignToMe = true,
  onChange,
}: {
  taskLabel: string;
  assigneeStaffId: string | null;
  staff: readonly AssigneeStaff[];
  myStaffId: string | null;
  canAssign: boolean;
  disabled?: boolean;
  showAssignToMe?: boolean;
  onChange: (assigneeStaffId: string | null) => void;
}) {
  const display = taskAssigneeDisplay(assigneeStaffId, staff);
  const me = myStaffId ? staff.find((s) => s.id === myStaffId) : undefined;
  const others = staff.filter((s) => s.id !== myStaffId);
  const avatar = (
    <span className="sx-avatar sx-assignee-avatar" data-unassigned={display.kind === 'unassigned' || undefined} aria-hidden="true">
      {display.kind === 'unassigned' ? '' : assigneeInitials(display.name)}
    </span>
  );

  if (!canAssign) {
    return (
      <span className="sx-assignee" data-kind={display.kind}>
        {avatar}
        <span className="sx-assignee-name">{display.name}</span>
      </span>
    );
  }

  return (
    <span className="sx-assignee" data-kind={display.kind}>
      {avatar}
      <select
        className="sx-assignee-select"
        value={assigneeStaffId ?? ''}
        disabled={disabled}
        aria-label={`Assignee for ${taskLabel}`}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Unassigned</option>
        {me && <option value={me.id}>{me.name} (me)</option>}
        {others.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
        {display.kind === 'unknown' && <option value={display.staffId}>{display.name}</option>}
      </select>
      {showAssignToMe && me && assigneeStaffId !== me.id && (
        <button type="button" className="sx-assign-me" disabled={disabled} onClick={() => onChange(me.id)} aria-label={`Assign ${taskLabel} to me`}>
          Assign to me
        </button>
      )}
    </span>
  );
}
