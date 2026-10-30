'use client';

import { Suspense, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTasks } from '@/hooks/useTasks';
import { useTaskMutations } from '@/hooks/useTaskMutations';
import { useReassignTask } from '@/hooks/useReassignTask';
import { useStaff } from '@/hooks/useStaff';
import { useCases } from '@/hooks/useCases';
import { useSession } from '@/hooks/useSession';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { compareTasksForDisplay } from '@/domain/tasks/rules';
import { filterTasksForView, parseTaskView, type TaskView } from '@/domain/tasks/assignment';
import { EmptyState } from '@/components/ui/EmptyState';
import { TaskComposer } from '@/components/tasks/TaskComposer';
import { TaskList } from '@/components/tasks/TaskList';
import type { TaskAssignmentContext, TaskRowItem } from '@/components/tasks/TaskRow';

/**
 * Tasks page (Frontend Engineering Plan, Phase 7) — the orchestration
 * layer. Fetches via hooks, derives the display list via useMemo (ordering
 * comes from domain/tasks/rules.ts's compareTasksForDisplay, not re-derived
 * here). TaskComposer owns its draft fields.
 *
 * Task assignment (2026-10): every task shows its assignee (or
 * "Unassigned"); staff with task.assign can assign, reassign, unassign or
 * take a task ("Assign to me"). "All tasks" / "Assigned to me" is kept in
 * the URL (`?view=mine`) so it survives a refresh and can be bookmarked.
 */
function TasksPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = parseTaskView(searchParams.get('view'));

  const { organizationId } = useOrganization();
  const session = useSession();
  const permissionsQuery = useMyPermissions(organizationId);
  // Same convention as the case page: while permissions load, controls
  // stay available — the server is the authority either way.
  const canAssign = !permissionsQuery.isSuccess || permissionsQuery.data.permissions.includes('task.assign');

  const tasksQuery = useTasks();
  const { data: staffList = [] } = useStaff();
  const { data: cases = [] } = useCases();
  const mutations = useTaskMutations();
  const reassign = useReassignTask();

  const staffOptions = useMemo(() => staffList.map((staff) => ({ id: staff.id, name: staff.displayName })), [staffList]);
  const caseOptions = useMemo(() => cases.map((case_) => ({ id: case_.id, name: case_.decedentName })), [cases]);
  const myStaffId = session.staffId;

  const allRows: TaskRowItem[] = useMemo(() => {
    const tasks = tasksQuery.data ?? [];
    return [...tasks].sort(compareTasksForDisplay).map((task) => {
      const linkedCase = task.caseId ? cases.find((c) => c.id === task.caseId) : undefined;
      return {
        id: task.id,
        text: task.text,
        isDone: task.isDone,
        assigneeStaffId: task.assigneeStaffId,
        linkedCaseId: task.caseId,
        linkedCaseName: linkedCase?.decedentName ?? null,
      };
    });
  }, [tasksQuery.data, cases]);

  const taskRows = useMemo(() => filterTasksForView(allRows, view, myStaffId), [allRows, view, myStaffId]);
  const mineOpenCount = useMemo(() => filterTasksForView(allRows, 'mine', myStaffId).filter((t) => !t.isDone).length, [allRows, myStaffId]);

  const openCount = taskRows.filter((t) => !t.isDone).length;
  const doneCount = taskRows.filter((t) => t.isDone).length;

  const assignment: TaskAssignmentContext = {
    staff: staffOptions,
    myStaffId,
    canAssign,
    onReassign: (taskId, assigneeStaffId) => reassign.mutate({ taskId, assigneeStaffId }),
  };

  function selectView(next: TaskView) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'mine') params.set('view', 'mine');
    else params.delete('view');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="sx-tasks">
      <div className="sx-page-header">
        <div>
          <h1 className="sx-page-title">Tasks</h1>
          <p className="sx-page-desc">Follow-ups, reminders and to-dos for the team.</p>
        </div>
        <span className="sx-tasks-count">
          <b>{openCount}</b> open · {doneCount} completed
        </span>
      </div>

      <TaskComposer staffOptions={staffOptions} caseOptions={caseOptions} myStaffId={myStaffId} canAssign={canAssign} onAddTask={(input) => mutations.addTask(input)} />

      <div className="sx-tasks-toolbar">
        <div className="sx-seg" role="tablist" aria-label="Which tasks to show">
          <button type="button" role="tab" aria-selected={view === 'all'} onClick={() => selectView('all')}>
            All tasks
          </button>
          <button type="button" role="tab" aria-selected={view === 'mine'} onClick={() => selectView('mine')}>
            Assigned to me
            {mineOpenCount > 0 && <span className="sx-seg-count">{mineOpenCount}</span>}
          </button>
        </div>
      </div>

      {reassign.isError && (
        <div className="sx-form-banner sx-form-banner-error" role="alert">
          The assignee could not be changed{reassign.error instanceof Error && reassign.error.message ? ` — ${reassign.error.message}` : ''}. Nothing was changed.
        </div>
      )}

      {tasksQuery.isPending ? (
        <div className="sx-loading" aria-busy="true">
          <span className="sx-skeleton" style={{ width: '90%' }} />
          <span className="sx-skeleton" style={{ width: '70%' }} />
          <span className="sx-skeleton" style={{ width: '80%' }} />
          <span className="sr-only">Loading tasks…</span>
        </div>
      ) : taskRows.length === 0 ? (
        view === 'mine' ? (
          <EmptyState
            message="Nothing assigned to you."
            helperText={myStaffId ? 'Use “Assign to me” on any task in All tasks to take it on.' : 'Your account has no staff profile yet, so no tasks can be assigned to you.'}
          />
        ) : (
          <EmptyState message="No tasks yet." helperText="Add a follow-up above. Tasks added from a case show up here too." />
        )
      ) : (
        <TaskList
          tasks={taskRows}
          assignment={assignment}
          onToggleTask={(taskId, newDone) => mutations.toggleTask({ taskId, isDone: newDone })}
          onRemoveTask={(taskId) => mutations.removeTask(taskId)}
        />
      )}
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<EmptyState message="Loading…" />}>
      <TasksPageContent />
    </Suspense>
  );
}
