import { TaskRow, type TaskRowItem } from './TaskRow';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './TaskList.module.css';

export function TaskList({
  tasks,
  onToggleTask,
  onRemoveTask,
}: {
  tasks: TaskRowItem[];
  onToggleTask: (taskId: string, newDone: boolean) => void;
  onRemoveTask: (taskId: string) => void;
}) {
  if (tasks.length === 0) {
    return <EmptyState message="No tasks yet — add one above." />;
  }

  return (
    <div className={styles.list}>
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          onToggle={(newDone) => onToggleTask(task.id, newDone)}
          onRemove={() => onRemoveTask(task.id)}
        />
      ))}
    </div>
  );
}
