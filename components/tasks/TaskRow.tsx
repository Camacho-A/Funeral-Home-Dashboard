import Link from 'next/link';
import { Checkbox } from '@/components/ui/Checkbox';
import styles from './TaskRow.module.css';

export type TaskRowItem = {
  id: string;
  text: string;
  isDone: boolean;
  assigneeName: string;
  linkedCaseId: string | null;
  linkedCaseName: string | null;
};

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
    <div className={styles.row}>
      <Checkbox
        checked={task.isDone}
        onChange={() => onToggle(!task.isDone)}
        tone="success"
        aria-label={task.text}
      />
      <span className={`${styles.text} ${task.isDone ? styles.textDone : styles.textActive}`}>
        {task.text}
      </span>
      {task.linkedCaseName && (
        <Link href={`/cases/${task.linkedCaseId}`} className={styles.linkedCase}>
          {task.linkedCaseName}
        </Link>
      )}
      <span className={styles.assignee}>{task.assigneeName}</span>
      <button type="button" className={styles.removeButton} onClick={onRemove} aria-label={`Remove ${task.text}`}>
        ×
      </button>
    </div>
  );
}
