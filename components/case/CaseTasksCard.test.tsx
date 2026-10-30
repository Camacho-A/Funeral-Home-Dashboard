import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CaseTasksCard, type CaseTaskItem } from './CaseTasksCard';

const TASK: CaseTaskItem = { id: 'task-1', text: 'Call the crematory', isDone: false, assigneeName: 'Dana' };

describe('CaseTasksCard — empty state and completion UX (Phase 17)', () => {
  it('shows an empty state when there are no tasks for this case', () => {
    render(<CaseTasksCard tasks={[]} onToggleTask={vi.fn()} onAddTask={vi.fn()} />);
    expect(screen.getByText(/no tasks for this case yet/i)).toBeInTheDocument();
  });

  it('calls onToggleTask with the flipped value when the checkbox is clicked', () => {
    const onToggleTask = vi.fn();
    render(<CaseTasksCard tasks={[TASK]} onToggleTask={onToggleTask} onAddTask={vi.fn()} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Call the crematory' }));
    expect(onToggleTask).toHaveBeenCalledWith('task-1', true);
  });

  it('shows a completed task with strikethrough styling, reflecting isDone instantly from props', () => {
    const done: CaseTaskItem = { ...TASK, isDone: true };
    render(<CaseTasksCard tasks={[done]} onToggleTask={vi.fn()} onAddTask={vi.fn()} />);

    const text = screen.getByText('Call the crematory');
    expect(text.className).toMatch(/textDone/);
    const checkbox = screen.getByRole('checkbox', { name: 'Call the crematory' });
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
  });

  it('quick-adds a task and clears the composer', () => {
    const onAddTask = vi.fn();
    render(<CaseTasksCard tasks={[]} onToggleTask={vi.fn()} onAddTask={onAddTask} />);

    const input = screen.getByPlaceholderText('Add a task for this case…');
    fireEvent.change(input, { target: { value: 'Confirm cemetery slot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    // SOLIS ALL-CAPS data standard (2026-09): the composer uppercases
    // as-you-type (UX only — the server normalizes authoritatively).
    expect(onAddTask).toHaveBeenCalledWith('CONFIRM CEMETERY SLOT');
    expect(input).toHaveValue('');
  });
});

describe('CaseTasksCard — assignee picker (2026-10)', () => {
  it('with assignment, each task’s assignee can be changed; without it the name is plain text', () => {
    const onReassign = vi.fn();
    const staff = [{ id: 'staff-dana', name: 'Dana' }, { id: 'staff-chris', name: 'Chris' }];
    const { rerender } = render(
      <CaseTasksCard
        tasks={[{ ...TASK, assigneeStaffId: 'staff-dana' }]}
        assignment={{ staff, myStaffId: 'staff-dana', canAssign: true, onReassign }}
        onToggleTask={vi.fn()}
        onAddTask={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: `Assignee for ${TASK.text}` }), { target: { value: 'staff-chris' } });
    expect(onReassign).toHaveBeenCalledWith('task-1', 'staff-chris');

    rerender(<CaseTasksCard tasks={[TASK]} onToggleTask={vi.fn()} onAddTask={vi.fn()} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Dana')).toBeInTheDocument();
  });
});

describe('long task text stays inside the card (2026-10)', () => {
  it('rows wrap, the text may shrink and break long words, and the assignee can move under it', async () => {
    const css = (await import('fs')).readFileSync('components/case/CaseTasksCard.module.css', 'utf8');
    const rule = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));
    expect(rule('.row')).toMatch(/flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.text,\s*\.textDone\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/);
    expect(rule('.assigneePicker')).toMatch(/max-width:\s*100%/);
    expect(rule('.assignee')).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
