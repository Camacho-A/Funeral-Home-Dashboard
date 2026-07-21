'use client';

import { useState } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import styles from './CaseTasksCard.module.css';

export type CaseTaskItem = {
  id: string;
  text: string;
  isDone: boolean;
  assigneeName: string;
};

/**
 * The quick-add text is local UI state; submitting calls onAddTask with just
 * the text — the page resolves the default assignee (see
 * domain/tasks/rules.ts's defaultAssigneeForCase) before creating the task,
 * keeping that domain rule out of this presentational component.
 */
export function CaseTasksCard({
  tasks,
  onToggleTask,
  onAddTask,
}: {
  tasks: CaseTaskItem[];
  onToggleTask: (taskId: string, newDone: boolean) => void;
  onAddTask: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');

  function handleAdd() {
    const text = draft.trim();
    if (!text) return;
    onAddTask(text);
    setDraft('');
  }

  return (
    <div className={styles.card}>
      <div className={styles.title}>Tasks for this case</div>
      <div className={styles.list}>
        {tasks.map((task) => (
          <div key={task.id} className={styles.row}>
            <Checkbox
              checked={task.isDone}
              onChange={() => onToggleTask(task.id, !task.isDone)}
              tone="success"
              size="sm"
              aria-label={task.text}
            />
            <span className={styles.text}>{task.text}</span>
            <span className={styles.assignee}>{task.assigneeName}</span>
          </div>
        ))}
      </div>
      <div className={styles.composer}>
        <TextField
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a task for this case…"
        />
        <Button onClick={handleAdd}>Add</Button>
      </div>
    </div>
  );
}
