'use client';

import { useMemo } from 'react';
import { useTasks } from '@/hooks/useTasks';
import { useTaskMutations } from '@/hooks/useTaskMutations';
import { useStaff } from '@/hooks/useStaff';
import { useCases } from '@/hooks/useCases';
import { compareTasksForDisplay } from '@/domain/tasks/rules';
import { EmptyState } from '@/components/ui/EmptyState';
import { TaskComposer } from '@/components/tasks/TaskComposer';
import { TaskList } from '@/components/tasks/TaskList';
import type { TaskRowItem } from '@/components/tasks/TaskRow';

/**
 * Tasks page (Frontend Engineering Plan, Phase 7) — the orchestration
 * layer. Fetches via hooks, derives the display list via useMemo (ordering
 * comes from domain/tasks/rules.ts's compareTasksForDisplay, not re-derived
 * here), and holds no local UI state of its own — TaskComposer owns its
 * draft fields, matching the Phase 6 pattern (CaseLogCard, CaseTasksCard).
 *
 * SOLIS Tasks/Calendar/Settings phase, §1.2: presentation only — wrapped in
 * `.sx-tasks`, the old `.card` shell removed, and the already-sorted
 * `taskRows` split into Open/Completed groups for display. No hook,
 * mutation, or ordering changed.
 */
export default function TasksPage() {
  const tasksQuery = useTasks();
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
    const tasks = tasksQuery.data ?? [];
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
  }, [tasksQuery.data, cases, staffList]);

  const openCount = taskRows.filter((t) => !t.isDone).length;
  const doneCount = taskRows.filter((t) => t.isDone).length;

  return (
    <div className="sx-tasks">
      <div className="sx-page-header">
        <div>
          <h1 className="sx-page-title">Tasks</h1>
          <p className="sx-page-desc">Follow-ups, reminders and to-dos for the team.</p>
        </div>
        <span style={{ fontSize: 13, color: 'var(--sx-muted)' }}>
          <b style={{ fontWeight: 600, color: 'var(--sx-text)' }}>{openCount}</b> open · {doneCount} completed
        </span>
      </div>

      <TaskComposer
        staffOptions={staffOptions}
        caseOptions={caseOptions}
        onAddTask={(input) => mutations.addTask(input)}
      />

      {tasksQuery.isPending ? (
        <div className="sx-loading" aria-busy="true">
          <span className="sx-skeleton" style={{ width: '90%' }} />
          <span className="sx-skeleton" style={{ width: '70%' }} />
          <span className="sx-skeleton" style={{ width: '80%' }} />
          <span className="sr-only">Loading tasks…</span>
        </div>
      ) : taskRows.length === 0 ? (
        <EmptyState message="No tasks yet." helperText="Add a follow-up above. Tasks added from a case show up here too." />
      ) : (
        <TaskList
          tasks={taskRows}
          onToggleTask={(taskId, newDone) => mutations.toggleTask({ taskId, isDone: newDone })}
          onRemoveTask={(taskId) => mutations.removeTask(taskId)}
        />
      )}
    </div>
  );
}
