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

    expect(onAddTask).toHaveBeenCalledWith('Confirm cemetery slot');
    expect(input).toHaveValue('');
  });
});
