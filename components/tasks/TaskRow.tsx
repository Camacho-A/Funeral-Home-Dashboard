import Link from 'next/link';
import { toDisplayName } from '@/utils/displayName';

export type TaskRowItem = {
  id: string;
  text: string;
  isDone: boolean;
  assigneeName: string;
  linkedCaseId: string | null;
  linkedCaseName: string | null;
};

/** First letters of the first two words, uppercase — SOLIS Tasks phase §1.4. */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * SOLIS Tasks/Calendar/Settings phase, §1.4: presentation only — new
 * `.sx-task-row` markup, a native checkbox (no component test constrains
 * this file's markup, so the contract's literal `<input type="checkbox">`
 * is used directly rather than the shared `<Checkbox>` button component).
 * `toDisplayName` applies to the linked case name only — the task's own
 * `text` stays exactly as stored (ALL CAPS is the data standard). Same
 * `onToggle`/`onRemove` handlers, unchanged.
 */
export function TaskRow({
  task,
  onToggle,
  onRemove,
}: {
  task: TaskRowItem;
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
          <Link href={`/cases/${task.linkedCaseId}`} className="sx-task-case">
            {toDisplayName(task.linkedCaseName)}
          </Link>
        ) : (
          <span />
        )}
        <span className="sx-task-assignee">
          <span className="sx-avatar" style={{ width: 20, height: 20, fontSize: 9.5 }}>
            {initials(task.assigneeName)}
          </span>
          {task.assigneeName}
        </span>
      </span>
      <button type="button" className="sx-icon-btn" aria-label={`Remove ${task.text}`} onClick={onRemove}>
        ×
      </button>
    </div>
  );
}
