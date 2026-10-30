import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TaskComposer } from './TaskComposer';

const staff = [
  { id: 'staff-chris', name: 'Chris Ortega' },
  { id: 'staff-dana', name: 'Dana Whitfield' },
];

function add(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Task' }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
}

describe('TaskComposer — assignee (2026-10)', () => {
  it('defaults a new task to the person adding it — not the first name in the list', () => {
    const onAddTask = vi.fn();
    render(<TaskComposer staffOptions={staff} caseOptions={[]} myStaffId="staff-dana" onAddTask={onAddTask} />);
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toHaveValue('staff-dana');
    add('call the hospital');
    expect(onAddTask).toHaveBeenCalledWith({ text: 'CALL THE HOSPITAL', assigneeStaffId: 'staff-dana', caseId: null });
  });

  it('Unassigned is a real choice', () => {
    const onAddTask = vi.fn();
    render(<TaskComposer staffOptions={staff} caseOptions={[]} myStaffId="staff-dana" onAddTask={onAddTask} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Assignee' }), { target: { value: '' } });
    add('order urn');
    expect(onAddTask).toHaveBeenCalledWith({ text: 'ORDER URN', assigneeStaffId: null, caseId: null });
  });

  it('assigns another staff member', () => {
    const onAddTask = vi.fn();
    render(<TaskComposer staffOptions={staff} caseOptions={[]} myStaffId="staff-dana" onAddTask={onAddTask} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Assignee' }), { target: { value: 'staff-chris' } });
    add('fax the doctor');
    expect(onAddTask).toHaveBeenCalledWith(expect.objectContaining({ assigneeStaffId: 'staff-chris' }));
  });

  it('a caller without a staff profile starts Unassigned', () => {
    const onAddTask = vi.fn();
    render(<TaskComposer staffOptions={staff} caseOptions={[]} myStaffId={null} onAddTask={onAddTask} />);
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toHaveValue('');
  });

  it('without task.assign there is no assignee picker and the task is created unassigned', () => {
    const onAddTask = vi.fn();
    render(<TaskComposer staffOptions={staff} caseOptions={[]} myStaffId="staff-dana" canAssign={false} onAddTask={onAddTask} />);
    expect(screen.queryByRole('combobox', { name: 'Assignee' })).not.toBeInTheDocument();
    add('follow up');
    expect(onAddTask).toHaveBeenCalledWith({ text: 'FOLLOW UP', assigneeStaffId: null, caseId: null });
  });
});
