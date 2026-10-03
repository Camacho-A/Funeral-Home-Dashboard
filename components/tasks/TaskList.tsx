import { TaskRow, type TaskRowItem } from './TaskRow';

/**
 * SOLIS Tasks/Calendar/Settings phase, §1.2 — splits the already-sorted
 * `tasks` (ordering comes from the page's own `compareTasksForDisplay`
 * call, not re-derived here) into Open/Completed groups for display only.
 * The page handles the empty-list case before rendering this component.
 */
export function TaskList({
  tasks,
  onToggleTask,
  onRemoveTask,
}: {
  tasks: TaskRowItem[];
  onToggleTask: (taskId: string, newDone: boolean) => void;
  onRemoveTask: (taskId: string) => void;
}) {
  const open = tasks.filter((t) => !t.isDone);
  const done = tasks.filter((t) => t.isDone);

  return (
    <>
      <section className="sx-task-group" aria-label="Open tasks">
        <h2 className="sx-section-title">
          Open<span className="sx-section-meta">{open.length} task{open.length === 1 ? '' : 's'}</span>
        </h2>
        {open.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onToggle={(newDone) => onToggleTask(task.id, newDone)}
            onRemove={() => onRemoveTask(task.id)}
          />
        ))}
      </section>

      {done.length > 0 && (
        <section className="sx-task-group" aria-label="Completed tasks">
          <h2 className="sx-section-title">
            Completed<span className="sx-section-meta">{done.length} task{done.length === 1 ? '' : 's'}</span>
          </h2>
          {done.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={(newDone) => onToggleTask(task.id, newDone)}
              onRemove={() => onRemoveTask(task.id)}
            />
          ))}
        </section>
      )}
    </>
  );
}
