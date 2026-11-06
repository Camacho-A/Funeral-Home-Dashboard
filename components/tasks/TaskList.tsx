'use client';

import { useState } from 'react';
import { TaskRow, type TaskAssignmentContext, type TaskRowItem } from './TaskRow';

/**
 * SOLIS Tasks/Calendar/Settings phase, §1.2 — splits the already-sorted
 * `tasks` (ordering comes from the page's own `compareTasksForDisplay`
 * call, not re-derived here) into Open/Completed groups for display only.
 * The page handles the empty-list case before rendering this component.
 *
 * 2026-11: no open tasks reads "All caught up"; completed tasks are folded
 * away behind "Show completed" so the open work stays first.
 */
export function TaskList({
  tasks,
  assignment,
  onToggleTask,
  onRemoveTask,
}: {
  tasks: TaskRowItem[];
  assignment: TaskAssignmentContext;
  onToggleTask: (taskId: string, newDone: boolean) => void;
  onRemoveTask: (taskId: string) => void;
}) {
  const [showDone, setShowDone] = useState(false);
  const open = tasks.filter((t) => !t.isDone);
  const done = tasks.filter((t) => t.isDone);
  const row = (task: TaskRowItem) => (
    <TaskRow key={task.id} task={task} assignment={assignment} onToggle={(newDone) => onToggleTask(task.id, newDone)} onRemove={() => onRemoveTask(task.id)} />
  );

  return (
    <>
      <section className="sx-task-group" aria-label="Open tasks">
        <div className="sx-task-group-head">
          <h2 className="sx-task-group-title">Open</h2>
          <span className="sx-task-group-count">{open.length}</span>
        </div>
        {open.length > 0 ? open.map(row) : <p className="sx-task-caught-up">All caught up — no open tasks.</p>}
      </section>

      {done.length > 0 && (
        <section className="sx-task-group" data-done-group aria-label="Completed tasks">
          <button type="button" className="sx-task-group-head sx-task-group-toggle" aria-expanded={showDone} onClick={() => setShowDone((value) => !value)}>
            <h2 className="sx-task-group-title">Completed</h2>
            <span className="sx-task-group-count">{done.length}</span>
            <span className="sx-task-group-action">{showDone ? 'Hide' : 'Show'}</span>
          </button>
          {showDone && done.map(row)}
        </section>
      )}
    </>
  );
}
