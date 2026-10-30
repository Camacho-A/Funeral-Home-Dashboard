import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TaskAssigneePicker } from './TaskAssigneePicker';

const staff = [
  { id: 'staff-dana', name: 'Dana Whitfield' },
  { id: 'staff-chris', name: 'Chris Ortega' },
];

function renderPicker(over: Partial<Parameters<typeof TaskAssigneePicker>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <TaskAssigneePicker taskLabel="CALL THE HOSPITAL" assigneeStaffId={null} staff={staff} myStaffId="staff-dana" canAssign onChange={onChange} {...over} />,
  );
  return { onChange };
}

describe('TaskAssigneePicker (2026-10)', () => {
  it('an unassigned task offers Unassigned, me first, then everyone else', () => {
    renderPicker();
    const select = screen.getByRole('combobox', { name: 'Assignee for CALL THE HOSPITAL' });
    expect(select).toHaveValue('');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Unassigned', 'Dana Whitfield (me)', 'Chris Ortega']);
  });

  it('"Assign to me" assigns the caller’s own staff profile', () => {
    const { onChange } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Assign CALL THE HOSPITAL to me' }));
    expect(onChange).toHaveBeenCalledWith('staff-dana');
  });

  it('reassigns to another staff member, and unassigns', () => {
    const { onChange } = renderPicker({ assigneeStaffId: 'staff-dana' });
    const select = screen.getByRole('combobox', { name: 'Assignee for CALL THE HOSPITAL' });
    fireEvent.change(select, { target: { value: 'staff-chris' } });
    expect(onChange).toHaveBeenLastCalledWith('staff-chris');
    fireEvent.change(select, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('a task already mine has no "Assign to me"', () => {
    renderPicker({ assigneeStaffId: 'staff-dana' });
    expect(screen.queryByRole('button', { name: /to me/ })).not.toBeInTheDocument();
  });

  it('a caller without a staff profile can still assign others but has no "Assign to me"', () => {
    renderPicker({ myStaffId: null });
    expect(screen.queryByRole('button', { name: /to me/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole('combobox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Unassigned', 'Dana Whitfield', 'Chris Ortega']);
  });

  it('without task.assign the assignee is read-only text', () => {
    renderPicker({ assigneeStaffId: 'staff-chris', canAssign: false });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Chris Ortega')).toBeInTheDocument();
  });

  it('a former staff member stays shown as the assignee, not as unassigned', () => {
    renderPicker({ assigneeStaffId: 'staff-gone' });
    expect(screen.getByRole('combobox')).toHaveValue('staff-gone');
    expect(screen.getByRole('option', { name: 'Former staff member' })).toBeInTheDocument();
  });
});
