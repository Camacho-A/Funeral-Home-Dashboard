import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

/**
 * Tasks page — assignment and views (2026-10). Data hooks are stubbed;
 * the server rules (permission, organization, staff profile) are covered
 * by app/api/tasks/**.
 */

const replace = vi.fn();
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/tasks',
  useSearchParams: () => new URLSearchParams(search),
}));

const reassignMutate = vi.fn();
let permissions: string[] = ['task.assign'];
let myStaffId: string | null = 'staff-dana';

const TASKS = [
  { id: 't1', organizationId: 'org', text: 'CALL THE HOSPITAL', assigneeStaffId: 'staff-dana', isDone: false, caseId: 'case-1', dueDate: null, createdAt: '2026-10-29T00:00:00Z' },
  { id: 't2', organizationId: 'org', text: 'ORDER URN', assigneeStaffId: 'staff-chris', isDone: false, caseId: null, dueDate: null, createdAt: '2026-10-29T00:00:00Z' },
  { id: 't3', organizationId: 'org', text: 'FILE PERMIT', assigneeStaffId: null, isDone: false, caseId: null, dueDate: null, createdAt: '2026-10-29T00:00:00Z' },
  { id: 't4', organizationId: 'org', text: 'OLD TASK', assigneeStaffId: 'staff-dana', isDone: true, caseId: null, dueDate: null, createdAt: '2026-10-29T00:00:00Z' },
];

vi.mock('@/hooks/useTasks', () => ({ useTasks: () => ({ data: TASKS, isPending: false }) }));
vi.mock('@/hooks/useStaff', () => ({
  useStaff: () => ({
    data: [
      { id: 'staff-dana', displayName: 'Dana Whitfield' },
      { id: 'staff-chris', displayName: 'Chris Ortega' },
    ],
  }),
}));
vi.mock('@/hooks/useCases', () => ({ useCases: () => ({ data: [{ id: 'case-1', decedentName: 'MISTY ANN AUTH' }] }) }));
vi.mock('@/hooks/useSession', () => ({ useSession: () => ({ staffId: myStaffId, displayName: 'Dana Whitfield' }) }));
vi.mock('@/hooks/useOrganization', () => ({ useOrganization: () => ({ organizationId: 'org', dataAdapterMode: 'mock' }) }));
vi.mock('@/hooks/useRbac', () => ({ useMyPermissions: () => ({ isSuccess: true, data: { permissions } }) }));
vi.mock('@/hooks/useTaskMutations', () => ({ useTaskMutations: () => ({ addTask: vi.fn(), toggleTask: vi.fn(), removeTask: vi.fn() }) }));
vi.mock('@/hooks/useReassignTask', () => ({ useReassignTask: () => ({ mutate: reassignMutate, isError: false, error: null }) }));

const { default: TasksPage } = await import('./page');

function openTaskTexts() {
  const open = screen.getByRole('region', { name: 'Open tasks' });
  return within(open)
    .queryAllByRole('checkbox')
    .map((c) => c.getAttribute('aria-label'));
}

beforeEach(() => {
  search = '';
  permissions = ['task.assign'];
  myStaffId = 'staff-dana';
  replace.mockClear();
  reassignMutate.mockClear();
});

describe('Tasks page — assignment (2026-10)', () => {
  it('"All tasks" shows every open task with its assignee — unassigned reads "Unassigned", never "Office"', () => {
    render(<TasksPage />);
    expect(openTaskTexts()).toEqual(['CALL THE HOSPITAL', 'ORDER URN', 'FILE PERMIT']);
    expect(screen.getByRole('combobox', { name: 'Assignee for ORDER URN' })).toHaveValue('staff-chris');
    expect(screen.getByRole('combobox', { name: 'Assignee for FILE PERMIT' })).toHaveValue('');
    expect(screen.queryByText('Office')).not.toBeInTheDocument();
  });

  it('"Assigned to me" (from the URL, so it survives a refresh) shows only my tasks', () => {
    search = 'view=mine';
    render(<TasksPage />);
    expect(screen.getByRole('tab', { name: /Assigned to me/ })).toHaveAttribute('aria-selected', 'true');
    expect(openTaskTexts()).toEqual(['CALL THE HOSPITAL']);
    expect(screen.getByRole('region', { name: 'Completed tasks' })).toHaveTextContent('OLD TASK');
  });

  it('switching views writes the URL', () => {
    render(<TasksPage />);
    fireEvent.click(screen.getByRole('tab', { name: /Assigned to me/ }));
    expect(replace).toHaveBeenCalledWith('/tasks?view=mine', { scroll: false });
    search = 'view=mine';
    replace.mockClear();
    render(<TasksPage />);
    fireEvent.click(screen.getAllByRole('tab', { name: 'All tasks' })[1]);
    expect(replace).toHaveBeenCalledWith('/tasks', { scroll: false });
  });

  it('the "Assigned to me" tab counts my open tasks', () => {
    render(<TasksPage />);
    expect(screen.getByRole('tab', { name: /Assigned to me/ })).toHaveTextContent('Assigned to me1');
  });

  it('reassign, unassign and "Assign to me" go through the reassign mutation', () => {
    render(<TasksPage />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Assignee for ORDER URN' }), { target: { value: 'staff-dana' } });
    expect(reassignMutate).toHaveBeenLastCalledWith({ taskId: 't2', assigneeStaffId: 'staff-dana' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Assignee for CALL THE HOSPITAL' }), { target: { value: '' } });
    expect(reassignMutate).toHaveBeenLastCalledWith({ taskId: 't1', assigneeStaffId: null });
    fireEvent.click(screen.getByRole('button', { name: 'Assign FILE PERMIT to me' }));
    expect(reassignMutate).toHaveBeenLastCalledWith({ taskId: 't3', assigneeStaffId: 'staff-dana' });
  });

  it('without task.assign, assignees are shown but cannot be changed', () => {
    permissions = [];
    render(<TasksPage />);
    expect(screen.queryByRole('combobox', { name: /Assignee for/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('Dana Whitfield').length).toBeGreaterThan(0);
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('a caller with no staff profile sees an explanation under "Assigned to me"', () => {
    myStaffId = null;
    search = 'view=mine';
    render(<TasksPage />);
    expect(screen.getByText('Nothing assigned to you.')).toBeInTheDocument();
    expect(screen.getByText(/no staff profile yet/)).toBeInTheDocument();
  });
});
