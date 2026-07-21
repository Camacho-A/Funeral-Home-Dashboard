'use client';

import { useMemo } from 'react';
import { useTasks } from '@/hooks/useTasks';
import { useTaskMutations } from '@/hooks/useTaskMutations';
import { useStaff } from '@/hooks/useStaff';
import { useCases } from '@/hooks/useCases';
import { compareTasksForDisplay } from '@/domain/tasks/rules';
import { TaskComposer } from '@/components/tasks/TaskComposer';
import { TaskList } from '@/components/tasks/TaskList';
import type { TaskRowItem } from '@/components/tasks/TaskRow';
import styles from './page.module.css';

/**
 * Tasks page (Frontend Engineering Plan, Phase 7) — the orchestration
 * layer. Fetches via hooks, derives the display list via useMemo (ordering
 * comes from domain/tasks/rules.ts's compareTasksForDisplay, not re-derived
 * here), and holds no local UI state of its own — TaskComposer owns its
 * draft fields, matching the Phase 6 pattern (CaseLogCard, CaseTasksCard).
 */
export default function TasksPage() {
  const { data: tasks = [] } = useTasks();
  const { data: staffList = [] } = useStaff();
  const { data: cases = [] } = useCases();
  const mutations = useTaskMutations();

  const staffOptions = useMemo(
    () => staffList.map((staff) => ({ id: staff.id, name: staff.displayName })),
    [staffList],
  );

  const caseOptions = useMemo(
    () => cases.map((case_) => ({ id: case_.id, name: case_.decedentName })),
    [cases],
  );

  const taskRows: TaskRowItem[] = useMemo(() => {
    return [...tasks].sort(compareTasksForDisplay).map((task) => {
      const linkedCase = task.caseId ? cases.find((c) => c.id === task.caseId) : undefined;
      return {
        id: task.id,
        text: task.text,
        isDone: task.isDone,
        assigneeName:
          staffList.find((staff) => staff.id === task.assigneeStaffId)?.displayName ?? 'Office',
        linkedCaseId: task.caseId,
        linkedCaseName: linkedCase?.decedentName ?? null,
      };
    });
  }, [tasks, cases, staffList]);

  return (
    <div>
      <h1 className={styles.title}>Tasks</h1>
      <div className={styles.card}>
        <TaskComposer
          staffOptions={staffOptions}
          caseOptions={caseOptions}
          onAddTask={(input) => mutations.addTask(input)}
        />
        <TaskList
          tasks={taskRows}
          onToggleTask={(taskId, newDone) => mutations.toggleTask({ taskId, isDone: newDone })}
          onRemoveTask={(taskId) => mutations.removeTask(taskId)}
        />
      </div>
    </div>
  );
}
