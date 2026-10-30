import { describe, expect, it } from 'vitest';
import { filterTasksForView, parseTaskView, taskAssigneeDisplay } from './assignment';

const staff = [
  { id: 'staff-dana', name: 'Dana Whitfield' },
  { id: 'staff-chris', name: 'Chris Ortega' },
];

describe('task assignee display (2026-10)', () => {
  it('an unassigned task reads "Unassigned" — never "Office"', () => {
    expect(taskAssigneeDisplay(null, staff)).toEqual({ kind: 'unassigned', name: 'Unassigned', staffId: null });
    expect(taskAssigneeDisplay('', staff).kind).toBe('unassigned');
  });

  it('an assigned task shows the staff member’s name', () => {
    expect(taskAssigneeDisplay('staff-chris', staff)).toEqual({ kind: 'staff', name: 'Chris Ortega', staffId: 'staff-chris' });
  });

  it('an assignee no longer among active staff stays assigned (never shown as unassigned)', () => {
    expect(taskAssigneeDisplay('staff-gone', staff)).toEqual({ kind: 'unknown', name: 'Former staff member', staffId: 'staff-gone' });
  });
});

describe('task views — "Assigned to me" and "All tasks" (2026-10)', () => {
  const tasks = [
    { id: 't1', assigneeStaffId: 'staff-dana' },
    { id: 't2', assigneeStaffId: 'staff-chris' },
    { id: 't3', assigneeStaffId: null },
  ];

  it('the URL value maps to a view; anything unknown is "All tasks"', () => {
    expect(parseTaskView('mine')).toBe('mine');
    expect(parseTaskView('all')).toBe('all');
    expect(parseTaskView(null)).toBe('all');
    expect(parseTaskView('someone-else')).toBe('all');
  });

  it('"All tasks" keeps every task, unassigned ones included', () => {
    expect(filterTasksForView(tasks, 'all', 'staff-dana').map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('"Assigned to me" keeps only the caller’s own tasks', () => {
    expect(filterTasksForView(tasks, 'mine', 'staff-dana').map((t) => t.id)).toEqual(['t1']);
  });

  it('a caller without a staff profile has nothing assigned to them', () => {
    expect(filterTasksForView(tasks, 'mine', null)).toEqual([]);
  });
});
