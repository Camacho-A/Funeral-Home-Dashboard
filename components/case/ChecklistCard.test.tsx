import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChecklistCard } from './ChecklistCard';
import type { ChecklistItemViewModel } from '../../types/caseViewModel';

/**
 * Editable-field save-race fix (2026-09). Root cause: a field-backed
 * checklist item's textbox used to be a bare, fully-controlled input
 * (`value={item.fieldValue} onChange={(e) => onFieldChange(item.index,
 * e.target.value)}`) — every keystroke called `onFieldChange` directly,
 * which hooks/useCaseMutations.ts#setFieldValue turns into a real
 * `updateCase.mutate(...)` (a live Wix PATCH in production). Typing "150"
 * fired three separate saves; under real network latency, a slower
 * request for an earlier keystroke could resolve after a faster request
 * for a later one and overwrite the query cache with a stale value,
 * visibly reverting what the user had already typed. This is the first
 * test file for ChecklistCard at all, so baseline (non-field, locked,
 * read-only, password) behavior is also covered here, not just the fix.
 */

function item(overrides: Partial<ChecklistItemViewModel>): ChecklistItemViewModel {
  return {
    index: 0,
    label: 'Item',
    done: false,
    locked: false,
    hasField: false,
    fieldValue: '',
    fieldIsPassword: false,
    isDerived: false,
    ...overrides,
  };
}

function renderChecklist(checklist: ChecklistItemViewModel[], overrides: Partial<Parameters<typeof ChecklistCard>[0]> = {}) {
  const onToggleItem = vi.fn();
  const onFieldChange = vi.fn();
  const onBackToCurrentStage = vi.fn();
  render(
    <ChecklistCard
      checklist={checklist}
      viewingStageLabel={null}
      onBackToCurrentStage={onBackToCurrentStage}
      onToggleItem={onToggleItem}
      onFieldChange={onFieldChange}
      {...overrides}
    />,
  );
  return { onToggleItem, onFieldChange, onBackToCurrentStage };
}

function weightField() {
  return screen.getByPlaceholderText('Enter value to complete this step…') as HTMLInputElement;
}

describe('ChecklistCard — baseline behavior (first test file for this component)', () => {
  it('toggling a plain (non-field) item calls onToggleItem with the flipped state', () => {
    const { onToggleItem } = renderChecklist([item({ index: 0, label: 'Payment collected', done: false })]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Payment collected' }));
    expect(onToggleItem).toHaveBeenCalledWith(0, true);
  });

  it('a locked item\'s checkbox is disabled and does not call onToggleItem', () => {
    const { onToggleItem } = renderChecklist([item({ index: 0, label: 'Locked item', locked: true })]);
    const checkbox = screen.getByRole('checkbox', { name: 'Locked item' });
    expect(checkbox).toBeDisabled();
    fireEvent.click(checkbox);
    expect(onToggleItem).not.toHaveBeenCalled();
  });

  it('a field-backed item never renders a clickable checkbox toggle (hasField disables it)', () => {
    renderChecklist([item({ index: 3, label: 'Weight', hasField: true, fieldValue: '150' })]);
    expect(screen.getByRole('checkbox', { name: 'Weight' })).toBeDisabled();
  });

  it('viewingStageLabel (past-stage read-only mode) disables the field input and shows the banner', () => {
    renderChecklist([item({ index: 3, label: 'Weight', hasField: true, fieldValue: '150' })], { viewingStageLabel: 'First Call & Payment' });
    expect(weightField()).toBeDisabled();
    expect(screen.getByText('First Call & Payment')).toBeInTheDocument();
    expect(screen.getByText('Back to current stage')).toBeInTheDocument();
  });

  it('a locked field-backed item\'s textbox is disabled', () => {
    renderChecklist([item({ index: 4, label: 'Date of death', hasField: true, locked: true })]);
    expect(weightField()).toBeDisabled();
  });

  it('a password-flagged field renders type="password"', () => {
    renderChecklist([item({ index: 9, label: 'Credit card payment collected by phone', hasField: true, fieldIsPassword: true })]);
    expect(weightField()).toHaveAttribute('type', 'password');
  });

  it('a non-password field renders type="text"', () => {
    renderChecklist([item({ index: 3, label: 'Weight', hasField: true })]);
    expect(weightField()).toHaveAttribute('type', 'text');
  });

  it('shows the current fieldValue when not focused', () => {
    renderChecklist([item({ index: 3, label: 'Weight', hasField: true, fieldValue: '178 lb' })]);
    expect(weightField().value).toBe('178 lb');
  });
});

describe('ChecklistCard — field-backed textbox save-race fix (2026-09)', () => {
  it('1/2. typing "150" one keystroke at a time never calls onFieldChange — no mutation merely from typing', () => {
    const { onFieldChange } = renderChecklist([item({ index: 3, label: 'Weight', hasField: true, fieldValue: '' })]);
    const input = weightField();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.change(input, { target: { value: '150' } });
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('3/4. committing on blur produces exactly ONE call, with the final typed value', () => {
    const { onFieldChange } = renderChecklist([item({ index: 3, label: 'Weight', hasField: true, fieldValue: '' })]);
    const input = weightField();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.blur(input);
    expect(onFieldChange).toHaveBeenCalledTimes(1);
    expect(onFieldChange).toHaveBeenCalledWith(3, '150');
  });

  it('3/4. committing via Enter also produces exactly ONE call, without losing focus', () => {
    const { onFieldChange } = renderChecklist([item({ index: 3, label: 'Weight', hasField: true, fieldValue: '' })]);
    const input = weightField();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onFieldChange).toHaveBeenCalledTimes(1);
    expect(onFieldChange).toHaveBeenCalledWith(3, '150');
    // Enter commits without forcing blur — the field stays focused/editable.
    fireEvent.change(input, { target: { value: '150 lb' } });
    fireEvent.blur(input);
    expect(onFieldChange).toHaveBeenCalledTimes(2);
    expect(onFieldChange).toHaveBeenLastCalledWith(3, '150 lb');
  });

  it('blurring without changing the value never calls onFieldChange', () => {
    const { onFieldChange } = renderChecklist([item({ index: 3, label: 'Weight', hasField: true, fieldValue: '178 lb' })]);
    const input = weightField();
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('5. an external value-prop update while actively editing does not overwrite in-progress typed text', () => {
    const onFieldChange = vi.fn();
    const { rerender } = render(
      <ChecklistCard
        checklist={[item({ index: 3, label: 'Weight', hasField: true, fieldValue: '' })]}
        viewingStageLabel={null}
        onBackToCurrentStage={vi.fn()}
        onToggleItem={vi.fn()}
        onFieldChange={onFieldChange}
      />,
    );
    const input = weightField();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '15' } });

    // Simulate a refetch/cache update landing mid-edit — a completely
    // unrelated field's value on the same case changed, causing the
    // parent to re-render with a new checklist array, but this item's
    // own fieldValue is unchanged (still '').
    rerender(
      <ChecklistCard
        checklist={[item({ index: 3, label: 'Weight', hasField: true, fieldValue: '' })]}
        viewingStageLabel={null}
        onBackToCurrentStage={vi.fn()}
        onToggleItem={vi.fn()}
        onFieldChange={onFieldChange}
      />,
    );

    expect(weightField().value).toBe('15');
    fireEvent.change(weightField(), { target: { value: '150' } });
    expect(weightField().value).toBe('150');
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('6. after a successful commit, the displayed value settles once the value prop catches up (no flicker back to stale)', () => {
    const onFieldChange = vi.fn();
    const { rerender } = render(
      <ChecklistCard
        checklist={[item({ index: 3, label: 'Weight', hasField: true, fieldValue: '' })]}
        viewingStageLabel={null}
        onBackToCurrentStage={vi.fn()}
        onToggleItem={vi.fn()}
        onFieldChange={onFieldChange}
      />,
    );
    const input = weightField();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.blur(input);
    expect(onFieldChange).toHaveBeenCalledWith(3, '150');

    // Immediately after commit, before the server response lands, the
    // field still shows what was just typed (the pendingValue echo) —
    // never reverts to the pre-edit fieldValue in the interim.
    expect(weightField().value).toBe('150');

    // The mutation's response arrives and the parent re-renders with the
    // now-updated fieldValue — the field correctly settles on it.
    rerender(
      <ChecklistCard
        checklist={[item({ index: 3, label: 'Weight', hasField: true, fieldValue: '150' })]}
        viewingStageLabel={null}
        onBackToCurrentStage={vi.fn()}
        onToggleItem={vi.fn()}
        onFieldChange={onFieldChange}
      />,
    );
    expect(weightField().value).toBe('150');
  });

  it('Escape reverts the in-progress draft without committing', () => {
    const { onFieldChange } = renderChecklist([item({ index: 3, label: 'Weight', hasField: true, fieldValue: '178 lb' })]);
    const input = weightField();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('178 lb');
    fireEvent.blur(input);
    expect(onFieldChange).not.toHaveBeenCalled();
  });
});
