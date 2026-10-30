'use client';

import { useState } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { TaskAssigneePicker } from '@/components/tasks/TaskAssigneePicker';
import type { TaskAssignmentContext } from '@/components/tasks/TaskRow';
import styles from './CaseTasksCard.module.css';

export type CaseTaskItem = {
  id: string;
  text: string;
  isDone: boolean;
  assigneeName: string;
  /** StaffProfile id, or null when unassigned (2026-10). */
  assigneeStaffId?: string | null;
};

/**
 * The quick-add text is local UI state; submitting calls onAddTask with just
 * the text — the page resolves the default assignee (see
 * domain/tasks/rules.ts's defaultAssigneeForCase) before creating the task,
 * keeping that domain rule out of this presentational component.
 */
export function CaseTasksCard({
  tasks,
  assignment,
  onToggleTask,
  onAddTask,
}: {
  tasks: CaseTaskItem[];
  /** Task assignment (2026-10): when given, each task's assignee is a
      picker (reassign, unassign, "Assign to me"), as on the Tasks page. */
  assignment?: TaskAssignmentContext;
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
      {tasks.length === 0 ? (
        <EmptyState message="No tasks for this case yet — add one below." />
      ) : (
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
              {/* Who has it first, then what it is (2026-10). */}
              <div className={styles.body}>
                {assignment ? (
                  <span className={styles.assigneePicker}>
                    <TaskAssigneePicker
                      taskLabel={task.text}
                      assigneeStaffId={task.assigneeStaffId ?? null}
                      staff={assignment.staff}
                      myStaffId={assignment.myStaffId}
                      canAssign={assignment.canAssign}
                      showAssignToMe={false}
                      onChange={(assigneeStaffId) => assignment.onReassign(task.id, assigneeStaffId)}
                    />
                  </span>
                ) : (
                  <span className={styles.assignee}>{task.assigneeName}</span>
                )}
                <span className={task.isDone ? styles.textDone : styles.text}>{task.text}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className={styles.composer}>
        <TextField
          value={draft}
          // SOLIS-wide ALL-CAPS data standard (2026-09): UX-only — the
          // server (lib/wixTaskMapper.ts) normalizes authoritatively.
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          placeholder="Add a task for this case…"
        />
        <Button onClick={handleAdd}>Add</Button>
      </div>
    </div>
  );
}
