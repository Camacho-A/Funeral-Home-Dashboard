import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
  const onSaveCertifierName = vi.fn();
  const onSaveCertifierPhone = vi.fn();
  const onUpdateCaseInfo = vi.fn();
  render(
    <ChecklistCard
      checklist={checklist}
      viewingStageLabel={null}
      onBackToCurrentStage={onBackToCurrentStage}
      onToggleItem={onToggleItem}
      onFieldChange={onFieldChange}
      onSaveCertifierName={onSaveCertifierName}
      onSaveCertifierPhone={onSaveCertifierPhone}
      onUpdateCaseInfo={onUpdateCaseInfo}
      {...overrides}
    />,
  );
  return { onToggleItem, onFieldChange, onBackToCurrentStage, onSaveCertifierName, onSaveCertifierPhone, onUpdateCaseInfo };
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

/**
 * Checklist Time Display (2026-09, ADR-041). A field-backed item whose
 * template metadata sets valueKind: 'time' renders three closed-option
 * selects instead of the plain text input above — driven by declarative
 * metadata, never a label match. Preserves the exact save-race discipline
 * (commit only on a real "done editing" signal), adapted for three
 * separate <select>s that have no single element to blur from.
 */
describe('ChecklistCard — Time of Death 12-hour display (valueKind: "time", 2026-09)', () => {
  function timeItem(overrides: Partial<ChecklistItemViewModel> = {}) {
    return item({ index: 5, label: 'Time of death', hasField: true, valueKind: 'time', fieldValue: '', ...overrides });
  }

  it('renders three selects (Hour/Minute/AM-PM) instead of the plain text input', () => {
    renderChecklist([timeItem()]);
    expect(screen.getByRole('combobox', { name: 'Hour' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Minute' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'AM or PM' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter value to complete this step…')).not.toBeInTheDocument();
  });

  it('shows the correct 12-hour parts for an existing 24-hour value when not being edited', () => {
    renderChecklist([timeItem({ fieldValue: '15:45' })]);
    expect(screen.getByRole('combobox', { name: 'Hour' })).toHaveValue('3');
    expect(screen.getByRole('combobox', { name: 'Minute' })).toHaveValue('45');
    expect(screen.getByRole('combobox', { name: 'AM or PM' })).toHaveValue('PM');
  });

  it('selecting all three parts, then moving focus out of the group, commits exactly once with canonical HH:mm', () => {
    const { onFieldChange } = renderChecklist([timeItem()]);
    const hour = screen.getByRole('combobox', { name: 'Hour' });
    const minute = screen.getByRole('combobox', { name: 'Minute' });
    const period = screen.getByRole('combobox', { name: 'AM or PM' });

    fireEvent.focus(hour);
    fireEvent.change(hour, { target: { value: '3' } });
    fireEvent.change(minute, { target: { value: '45' } });
    fireEvent.change(period, { target: { value: 'PM' } });
    expect(onFieldChange).not.toHaveBeenCalled();

    fireEvent.blur(period, { relatedTarget: document.body });
    expect(onFieldChange).toHaveBeenCalledTimes(1);
    expect(onFieldChange).toHaveBeenCalledWith(5, '15:45');
  });

  it('moving focus BETWEEN the three selects (still inside the group) does not commit and does not discard the in-progress selection', () => {
    const { onFieldChange } = renderChecklist([timeItem()]);
    const hour = screen.getByRole('combobox', { name: 'Hour' });
    const minute = screen.getByRole('combobox', { name: 'Minute' });
    const period = screen.getByRole('combobox', { name: 'AM or PM' });

    fireEvent.focus(hour);
    fireEvent.change(hour, { target: { value: '3' } });
    // Focus moves to a sibling select still inside the same group — must
    // not re-sync from the (still-empty) canonical value and wipe out the
    // hour just picked.
    fireEvent.blur(hour, { relatedTarget: minute });
    fireEvent.focus(minute);
    expect(hour).toHaveValue('3');
    expect(onFieldChange).not.toHaveBeenCalled();

    fireEvent.change(minute, { target: { value: '45' } });
    fireEvent.blur(minute, { relatedTarget: period });
    fireEvent.focus(period);
    fireEvent.change(period, { target: { value: 'PM' } });
    fireEvent.blur(period, { relatedTarget: document.body });

    expect(onFieldChange).toHaveBeenCalledTimes(1);
    expect(onFieldChange).toHaveBeenCalledWith(5, '15:45');
  });

  it('Enter commits without needing to blur the group', () => {
    const { onFieldChange } = renderChecklist([timeItem()]);
    const hour = screen.getByRole('combobox', { name: 'Hour' });
    const minute = screen.getByRole('combobox', { name: 'Minute' });
    const period = screen.getByRole('combobox', { name: 'AM or PM' });

    fireEvent.focus(hour);
    fireEvent.change(hour, { target: { value: '8' } });
    fireEvent.change(minute, { target: { value: '30' } });
    fireEvent.change(period, { target: { value: 'PM' } });
    fireEvent.keyDown(period, { key: 'Enter' });

    expect(onFieldChange).toHaveBeenCalledTimes(1);
    expect(onFieldChange).toHaveBeenCalledWith(5, '20:30');
  });

  it('an incomplete selection (only hour + minute, no AM/PM) never commits, even on blur out of the group', () => {
    const { onFieldChange } = renderChecklist([timeItem()]);
    const hour = screen.getByRole('combobox', { name: 'Hour' });
    const minute = screen.getByRole('combobox', { name: 'Minute' });

    fireEvent.focus(hour);
    fireEvent.change(hour, { target: { value: '8' } });
    fireEvent.change(minute, { target: { value: '30' } });
    fireEvent.blur(minute, { relatedTarget: document.body });

    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('Escape reverts the in-progress selection to the last saved value', () => {
    const { onFieldChange } = renderChecklist([timeItem({ fieldValue: '15:45' })]);
    const hour = screen.getByRole('combobox', { name: 'Hour' });

    fireEvent.focus(hour);
    fireEvent.change(hour, { target: { value: '9' } });
    fireEvent.keyDown(hour, { key: 'Escape' });

    expect(screen.getByRole('combobox', { name: 'Hour' })).toHaveValue('3');
    fireEvent.blur(hour, { relatedTarget: document.body });
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('a locked time item disables all three selects', () => {
    renderChecklist([timeItem({ locked: true })]);
    expect(screen.getByRole('combobox', { name: 'Hour' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Minute' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'AM or PM' })).toBeDisabled();
  });

  it('viewingStageLabel (past-stage read-only mode) disables all three selects', () => {
    renderChecklist([timeItem({ fieldValue: '15:45' })], { viewingStageLabel: 'First Call & Payment' });
    expect(screen.getByRole('combobox', { name: 'Hour' })).toBeDisabled();
  });
});

/**
 * Task #7 reopened (2026-09). The Workflow checklist's Certifier
 * Information item previously rendered nothing editable at all for a
 * clean v5+ Case (hasField: false, no UI branch handled it) and, for a
 * legacy Case, silently exposed the raw legacy dcContact fieldValues box
 * relabeled to look like the new item — staff typing a name there saved
 * into fieldValues, never into Case.certifierName/certifierPhone, and no
 * phone field existed at all. These tests cover the new dual-field
 * editor, driven generically by requiredCaseFields/requiredCaseFieldValues
 * (any recognized field name), reusing the exact same
 * ChecklistFieldInput save-race-safe textbox every hasField item uses.
 */
function certifierItem(overrides: Partial<ChecklistItemViewModel> = {}): ChecklistItemViewModel {
  return item({
    index: 6,
    label: 'Certifier Information',
    hasField: false,
    isDerived: true,
    requiredCaseFields: ['certifierName', 'certifierPhone'],
    requiredCaseFieldValues: { certifierName: '', certifierPhone: '' },
    ...overrides,
  });
}

function certifierNameField() {
  return within(screen.getByText('Certifier name').parentElement!).getByRole('textbox') as HTMLInputElement;
}

function certifierPhoneField() {
  return within(screen.getByText('Certifier phone').parentElement!).getByRole('textbox') as HTMLInputElement;
}

describe('ChecklistCard — Certifier Information dual-field editor (Task #7 reopened, 2026-09)', () => {
  it('1. renders a Certifier name field', () => {
    renderChecklist([certifierItem()]);
    expect(screen.getByText('Certifier name')).toBeInTheDocument();
  });

  it('2. renders a Certifier phone field', () => {
    renderChecklist([certifierItem()]);
    expect(screen.getByText('Certifier phone')).toBeInTheDocument();
  });

  it('3. the Name field reads its value from requiredCaseFieldValues.certifierName (i.e. Case.certifierName)', () => {
    renderChecklist([certifierItem({ requiredCaseFieldValues: { certifierName: 'DR. JANE FOSTER', certifierPhone: '' } })]);
    expect(certifierNameField()).toHaveValue('DR. JANE FOSTER');
  });

  it('4. the Phone field reads its value from requiredCaseFieldValues.certifierPhone (i.e. Case.certifierPhone)', () => {
    renderChecklist([certifierItem({ requiredCaseFieldValues: { certifierName: '', certifierPhone: '555-0199' } })]);
    expect(certifierPhoneField()).toHaveValue('555-0199');
  });

  it('5. editing and committing the Name field calls onSaveCertifierName, never onFieldChange', () => {
    const { onSaveCertifierName, onFieldChange } = renderChecklist([certifierItem()]);
    const nameField = certifierNameField();
    fireEvent.focus(nameField);
    fireEvent.change(nameField, { target: { value: 'DR. JANE FOSTER' } });
    fireEvent.blur(nameField);
    expect(onSaveCertifierName).toHaveBeenCalledWith('DR. JANE FOSTER');
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('6. editing and committing the Phone field calls onSaveCertifierPhone, never onFieldChange', () => {
    const { onSaveCertifierPhone, onFieldChange } = renderChecklist([certifierItem()]);
    const phoneField = certifierPhoneField();
    fireEvent.focus(phoneField);
    fireEvent.change(phoneField, { target: { value: '555-0199' } });
    fireEvent.blur(phoneField);
    expect(onSaveCertifierPhone).toHaveBeenCalledWith('555-0199');
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('7. clearing a field commits null, not an empty string (matches Case Information\'s own convention)', () => {
    const { onSaveCertifierPhone } = renderChecklist([
      certifierItem({ requiredCaseFieldValues: { certifierName: '', certifierPhone: '555-0199' } }),
    ]);
    const phoneField = certifierPhoneField();
    fireEvent.focus(phoneField);
    fireEvent.change(phoneField, { target: { value: '   ' } });
    fireEvent.blur(phoneField);
    expect(onSaveCertifierPhone).toHaveBeenCalledWith(null);
  });

  it('8. the checkbox stays disabled (isDerived) — completion is never manually toggleable for this item', () => {
    renderChecklist([certifierItem()]);
    expect(screen.getByRole('checkbox', { name: 'Certifier Information' })).toBeDisabled();
  });

  it('a locked Certifier item disables both fields', () => {
    renderChecklist([certifierItem({ locked: true })]);
    expect(certifierNameField()).toBeDisabled();
    expect(certifierPhoneField()).toBeDisabled();
  });

  it('Task #7 reopened, second follow-up (2026-09): viewingStageLabel (past-stage viewing) does NOT disable the Certifier fields — Name/Phone are live Case data, editable regardless of which stage is being viewed', () => {
    const { onSaveCertifierName } = renderChecklist([certifierItem()], { viewingStageLabel: 'First Call & Payment' });
    expect(certifierNameField()).not.toBeDisabled();
    expect(certifierPhoneField()).not.toBeDisabled();
    const nameField = certifierNameField();
    fireEvent.focus(nameField);
    fireEvent.change(nameField, { target: { value: 'DR. JANE FOSTER' } });
    fireEvent.blur(nameField);
    expect(onSaveCertifierName).toHaveBeenCalledWith('DR. JANE FOSTER');
  });

  it('a locked Certifier item still disables both fields even in past-stage view (item.locked always wins)', () => {
    renderChecklist([certifierItem({ locked: true })], { viewingStageLabel: 'First Call & Payment' });
    expect(certifierNameField()).toBeDisabled();
    expect(certifierPhoneField()).toBeDisabled();
  });

  it('an item with no requiredCaseFields at all renders neither sub-field (baseline non-field item unaffected)', () => {
    renderChecklist([item({ index: 0, label: 'Payment collected' })]);
    expect(screen.queryByText('Certifier name')).not.toBeInTheDocument();
    expect(screen.queryByText('Certifier phone')).not.toBeInTheDocument();
  });

  it('an isDerived item with requiredCaseFields empty renders no sub-fields (the terminal return-of-remains item\'s own isDerived is unaffected)', () => {
    renderChecklist([item({ index: 7, label: 'Return of remains', isDerived: true, requiredCaseFields: undefined })]);
    expect(screen.queryByText('Certifier name')).not.toBeInTheDocument();
    expect(screen.queryByText('Certifier phone')).not.toBeInTheDocument();
  });
});

/**
 * Task #7 UI consistency follow-up (2026-09). Family Contact reuses the
 * SAME generic RequiredCaseFieldsGroup renderer as Certifier, but saves
 * through the single generic `onUpdateCaseInfo` callback (mirroring
 * CaseInformationCard.tsx's own Next of kin fields exactly), not a
 * dedicated per-field mutation, and Email gets the same validate-before-
 * commit/revert-on-blur behavior as CaseInformationCard's own kind='email'
 * EditableField.
 */
function familyContactItem(overrides: Partial<ChecklistItemViewModel> = {}): ChecklistItemViewModel {
  return item({
    index: 7,
    label: 'Family contact — name, phone number & email',
    hasField: false,
    isDerived: true,
    requiredCaseFields: ['nextOfKinName', 'nextOfKinPhone', 'nextOfKinEmail'],
    requiredCaseFieldValues: { nextOfKinName: '', nextOfKinPhone: '', nextOfKinEmail: '' },
    ...overrides,
  });
}

function nokNameField() {
  return within(screen.getByText('Next of kin').parentElement!).getByRole('textbox') as HTMLInputElement;
}

function nokPhoneField() {
  return within(screen.getByText('NOK phone').parentElement!).getByRole('textbox') as HTMLInputElement;
}

function nokEmailField() {
  return within(screen.getByText('NOK email').parentElement!).getByRole('textbox') as HTMLInputElement;
}

describe('ChecklistCard — Family Contact structured Name/Phone/Email editor (Task #7 UI consistency follow-up, 2026-09)', () => {
  it('1/2/3/4. renders Name, Phone, and Email fields — exactly three inputs, the old combined free-text box no longer renders', () => {
    renderChecklist([familyContactItem()]);
    expect(screen.getByText('Next of kin')).toBeInTheDocument();
    expect(screen.getByText('NOK phone')).toBeInTheDocument();
    expect(screen.getByText('NOK email')).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText('Enter value to complete this step…')).toHaveLength(3);
  });

  it('5. Name/Phone/Email are initially blank when the structured Case fields are blank', () => {
    renderChecklist([familyContactItem()]);
    expect(nokNameField()).toHaveValue('');
    expect(nokPhoneField()).toHaveValue('');
    expect(nokEmailField()).toHaveValue('');
  });

  it('displays existing structured values when populated', () => {
    renderChecklist([
      familyContactItem({
        requiredCaseFieldValues: { nextOfKinName: 'KAREN ELLISON', nextOfKinPhone: '555-0155', nextOfKinEmail: 'karen@example.com' },
      }),
    ]);
    expect(nokNameField()).toHaveValue('KAREN ELLISON');
    expect(nokPhoneField()).toHaveValue('555-0155');
    expect(nokEmailField()).toHaveValue('karen@example.com');
  });

  it('9. editing and committing Name calls onUpdateCaseInfo with { nextOfKinName }, uppercased, never onFieldChange', () => {
    const { onUpdateCaseInfo, onFieldChange } = renderChecklist([familyContactItem()]);
    const nameField = nokNameField();
    fireEvent.focus(nameField);
    fireEvent.change(nameField, { target: { value: 'karen ellison' } });
    fireEvent.blur(nameField);
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ nextOfKinName: 'KAREN ELLISON' });
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('10. editing and committing Phone calls onUpdateCaseInfo with { nextOfKinPhone }, unmasked (no uppercase)', () => {
    const { onUpdateCaseInfo } = renderChecklist([familyContactItem()]);
    const phoneField = nokPhoneField();
    fireEvent.focus(phoneField);
    fireEvent.change(phoneField, { target: { value: '555-0155' } });
    fireEvent.blur(phoneField);
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ nextOfKinPhone: '555-0155' });
  });

  it('11. editing and committing a valid Email calls onUpdateCaseInfo with { nextOfKinEmail }', () => {
    const { onUpdateCaseInfo } = renderChecklist([familyContactItem()]);
    const emailField = nokEmailField();
    fireEvent.focus(emailField);
    fireEvent.change(emailField, { target: { value: 'karen@example.com' } });
    fireEvent.blur(emailField);
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ nextOfKinEmail: 'karen@example.com' });
  });

  it('an invalid Email does not commit on blur — silently reverts, matching EditableField kind="email" behavior', () => {
    const { onUpdateCaseInfo } = renderChecklist([
      familyContactItem({ requiredCaseFieldValues: { nextOfKinName: '', nextOfKinPhone: '', nextOfKinEmail: 'karen@example.com' } }),
    ]);
    const emailField = nokEmailField();
    fireEvent.focus(emailField);
    fireEvent.change(emailField, { target: { value: 'not-an-email' } });
    fireEvent.blur(emailField);
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    expect(nokEmailField()).toHaveValue('karen@example.com');
  });

  it('an invalid Email on Enter shows an inline error and preserves the typed text', () => {
    const { onUpdateCaseInfo } = renderChecklist([familyContactItem()]);
    const emailField = nokEmailField();
    fireEvent.focus(emailField);
    fireEvent.change(emailField, { target: { value: 'not-an-email' } });
    fireEvent.keyDown(emailField, { key: 'Enter' });
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    expect(emailField).toHaveValue('not-an-email');
  });

  it('clearing a field commits null, not an empty string', () => {
    const { onUpdateCaseInfo } = renderChecklist([
      familyContactItem({ requiredCaseFieldValues: { nextOfKinName: '', nextOfKinPhone: '555-0155', nextOfKinEmail: '' } }),
    ]);
    const phoneField = nokPhoneField();
    fireEvent.focus(phoneField);
    fireEvent.change(phoneField, { target: { value: '   ' } });
    fireEvent.blur(phoneField);
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ nextOfKinPhone: null });
  });

  it('17. viewingStageLabel (past-stage viewing) does NOT disable the Family Contact fields — live Case data, editable regardless of stage', () => {
    renderChecklist([familyContactItem()], { viewingStageLabel: 'First Call & Payment' });
    expect(nokNameField()).not.toBeDisabled();
    expect(nokPhoneField()).not.toBeDisabled();
    expect(nokEmailField()).not.toBeDisabled();
  });

  it('a locked Family Contact item disables all three fields even in past-stage view', () => {
    renderChecklist([familyContactItem({ locked: true })], { viewingStageLabel: 'First Call & Payment' });
    expect(nokNameField()).toBeDisabled();
    expect(nokPhoneField()).toBeDisabled();
    expect(nokEmailField()).toBeDisabled();
  });

  it('the checkbox stays disabled (isDerived) — never manually toggled, matching every other hasField-turned-structured item', () => {
    renderChecklist([familyContactItem()]);
    expect(screen.getByRole('checkbox', { name: 'Family contact — name, phone number & email' })).toBeDisabled();
  });
});

describe('ChecklistCard — terminal "Family picked up ashes" action (2026-10)', () => {
  function terminalItem(overrides: Partial<ChecklistItemViewModel> = {}, record: Partial<NonNullable<ChecklistItemViewModel['returnRequirement']>> = {}) {
    return item({
      index: 0,
      label: 'Family picked up ashes',
      isDerived: true,
      ...overrides,
      returnRequirement: {
        returnMethod: 'pickup',
        pickupReleasedTo: null,
        pickupReleasedAt: null,
        pickupNote: null,
        shippingDeliveryStatus: null,
        shippingDeliveredAt: null,
        ...record,
      },
    });
  }

  function openDialog() {
    fireEvent.click(screen.getByRole('button', { name: 'Record family pickup' }));
    return within(screen.getByRole('dialog'));
  }

  function fillValidRelease(dialog: ReturnType<typeof within>) {
    fireEvent.change(dialog.getByLabelText('Released to'), { target: { value: 'karen ellison' } });
    fireEvent.change(dialog.getByLabelText('Released date'), { target: { value: '10/09/2026' } });
    return dialog;
  }

  it('the checkbox itself stays read-only — the derived signal is never independently toggleable', () => {
    // The whole point of the 2026-09 design: the checkbox must not become a
    // second completion signal that can contradict the release record.
    const { onToggleItem } = renderChecklist([terminalItem()]);
    const checkbox = screen.getByRole('checkbox', { name: 'Family picked up ashes' });
    expect(checkbox).toBeDisabled();
    fireEvent.click(checkbox);
    expect(onToggleItem).not.toHaveBeenCalled();
  });

  it('offers staff a way to record the pickup from the workflow itself', () => {
    renderChecklist([terminalItem()]);
    expect(screen.getByRole('button', { name: 'Record family pickup' })).toBeEnabled();
  });

  it('records the release and its documentation in a single patch', () => {
    const { onUpdateCaseInfo, onToggleItem } = renderChecklist([terminalItem()]);
    const dialog = fillValidRelease(openDialog());
    fireEvent.change(dialog.getByLabelText('Note (optional)'), { target: { value: 'photo id checked' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Record pickup' }));

    // One patch — the status and the documentation justifying it can never
    // be persisted apart, so assertValidPickupReleasePatch always passes.
    expect(onUpdateCaseInfo).toHaveBeenCalledTimes(1);
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({
      pickupStatus: 'released',
      pickupReleasedTo: 'KAREN ELLISON',
      pickupReleasedAt: '10/09/2026',
      pickupNote: 'PHOTO ID CHECKED',
    });
    // Completion still flows only from the release record.
    expect(onToggleItem).not.toHaveBeenCalled();
  });

  it('cannot save without the required release documentation', () => {
    const { onUpdateCaseInfo } = renderChecklist([terminalItem()]);
    const dialog = openDialog();
    const save = dialog.getByRole('button', { name: 'Record pickup' });

    expect(save).toBeDisabled();

    // Name alone is not enough.
    fireEvent.change(dialog.getByLabelText('Released to'), { target: { value: 'KAREN ELLISON' } });
    expect(save).toBeDisabled();

    // Nor is an invalid date.
    fireEvent.change(dialog.getByLabelText('Released date'), { target: { value: '13/45/2026' } });
    expect(save).toBeDisabled();

    fireEvent.change(dialog.getByLabelText('Released date'), { target: { value: '10/09/2026' } });
    expect(save).toBeEnabled();

    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('refuses a release dated in the future', () => {
    renderChecklist([terminalItem()]);
    const dialog = openDialog();
    fireEvent.change(dialog.getByLabelText('Released to'), { target: { value: 'KAREN ELLISON' } });
    fireEvent.change(dialog.getByLabelText('Released date'), { target: { value: '12/31/2099' } });

    expect(dialog.getByRole('alert')).toHaveTextContent('Released date cannot be in the future.');
    expect(dialog.getByRole('button', { name: 'Record pickup' })).toBeDisabled();
  });

  it('an optional note left blank is sent as null, never an empty string', () => {
    const { onUpdateCaseInfo } = renderChecklist([terminalItem()]);
    fireEvent.click(fillValidRelease(openDialog()).getByRole('button', { name: 'Record pickup' }));
    expect(onUpdateCaseInfo).toHaveBeenCalledWith(expect.objectContaining({ pickupNote: null }));
  });

  it('shows the recorded release once it exists, instead of the action', () => {
    renderChecklist([
      terminalItem({ done: true }, { pickupReleasedTo: 'KAREN ELLISON', pickupReleasedAt: '10/09/2026' }),
    ]);

    expect(screen.getByText(/Released to/)).toHaveTextContent('Released to KAREN ELLISON on 10/09/2026.');
    expect(screen.queryByRole('button', { name: 'Record family pickup' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Family picked up ashes' })).toBeChecked();
  });

  it('a recorded release can be corrected, pre-filled from what is stored', () => {
    const { onUpdateCaseInfo } = renderChecklist([
      terminalItem({ done: true }, { pickupReleasedTo: 'KAREN ELLISON', pickupReleasedAt: '10/09/2026' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Correct this record' }));
    const dialog = within(screen.getByRole('dialog'));

    expect(dialog.getByLabelText('Released to')).toHaveValue('KAREN ELLISON');
    expect(dialog.getByLabelText('Released date')).toHaveValue('10/09/2026');

    fireEvent.change(dialog.getByLabelText('Released to'), { target: { value: 'MICHAEL ELLISON' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Record pickup' }));
    expect(onUpdateCaseInfo).toHaveBeenCalledWith(expect.objectContaining({ pickupReleasedTo: 'MICHAEL ELLISON' }));
  });

  it('an undecided return method explains what is needed instead of showing a dead control', () => {
    renderChecklist([
      terminalItem({ label: 'Return of cremated remains confirmed' }, { returnMethod: 'undecided' }),
    ]);

    // Matched on a contiguous text node — the sentence is split by <b>.
    expect(screen.getByText(/to record how the cremated\s+remains were returned/)).toBeInTheDocument();
    // No "mark complete anyway" escape hatch — an undecided case must not
    // be able to record a release that never happened.
    expect(screen.queryByRole('button', { name: 'Record family pickup' })).not.toBeInTheDocument();
  });

  it('a shipping case points at delivery confirmation, never at a pickup it is not having', () => {
    renderChecklist([
      terminalItem({ label: 'Cremated remains confirmed delivered' }, { returnMethod: 'shipping' }),
    ]);

    expect(screen.getByText(/This case is being shipped/)).toBeInTheDocument();
    expect(screen.getByText(/is\s+set to Delivered/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record family pickup' })).not.toBeInTheDocument();
  });

  it('a delivered shipping case shows the confirmed delivery', () => {
    renderChecklist([
      terminalItem(
        { label: 'Cremated remains confirmed delivered', done: true },
        { returnMethod: 'shipping', shippingDeliveryStatus: 'delivered', shippingDeliveredAt: '10/09/2026' },
      ),
    ]);
    expect(screen.getByText('Delivery confirmed on 10/09/2026.')).toBeInTheDocument();
  });

  it('viewing a past stage read-only offers no way to record a release', () => {
    renderChecklist([terminalItem()], { viewingStageLabel: 'Ready for Pickup / Contact Family' });
    expect(screen.getByRole('button', { name: 'Record family pickup' })).toBeDisabled();
  });

  it('a caller with no update capability gets no enabled action', () => {
    // The page only passes onUpdateCaseInfo when the viewer may edit the
    // case; without it there is nothing to click.
    renderChecklist([terminalItem()], { onUpdateCaseInfo: undefined });
    expect(screen.getByRole('button', { name: 'Record family pickup' })).toBeDisabled();
  });

  it('ordinary items are completely unaffected — no action, still toggleable', () => {
    const { onToggleItem } = renderChecklist([item({ index: 0, label: 'Labels made' })]);
    expect(screen.queryByRole('button', { name: 'Record family pickup' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Labels made' }));
    expect(onToggleItem).toHaveBeenCalledWith(0, true);
  });
});

describe('ChecklistCard — contact restriction on the Family Contact item (2026-10)', () => {
  function familyContactItem() {
    return item({
      index: 7,
      label: 'Family contact — name, phone number & email',
      isDerived: true,
      requiredCaseFields: ['nextOfKinName', 'nextOfKinPhone', 'nextOfKinEmail'],
      requiredCaseFieldValues: {
        nextOfKinName: 'KAREN ELLISON',
        nextOfKinPhone: '(555) 201-4432',
        nextOfKinEmail: 'karen@example.com',
      },
    });
  }

  it('warns, and names who to route through, when a restriction is active', () => {
    renderChecklist([familyContactItem()], {
      contactRestriction: { active: true, arrangementContactName: 'MICHAEL ELLISON' },
    });

    expect(screen.getByText('Do not contact next of kin directly.')).toBeInTheDocument();
    expect(screen.getByText(/Route contact through MICHAEL ELLISON/)).toBeInTheDocument();
  });

  it('never implies a substitute contact exists when none is named', () => {
    renderChecklist([familyContactItem()], {
      contactRestriction: { active: true, arrangementContactName: null },
    });

    expect(screen.getByText('Do not contact next of kin directly.')).toBeInTheDocument();
    expect(screen.queryByText(/Route contact through/)).not.toBeInTheDocument();
  });

  it('shows nothing alarming when no restriction is recorded', () => {
    renderChecklist([familyContactItem()], {
      contactRestriction: { active: false, arrangementContactName: null },
    });
    expect(screen.queryByText('Do not contact next of kin directly.')).not.toBeInTheDocument();
  });

  it('a legacy case with no restriction prop is unaffected', () => {
    renderChecklist([familyContactItem()]);
    expect(screen.queryByText('Do not contact next of kin directly.')).not.toBeInTheDocument();
    // The next-of-kin fields still render and remain editable.
    expect(screen.getByDisplayValue('KAREN ELLISON')).toBeInTheDocument();
  });

  it('the restriction never clears or alters the legal next-of-kin values', () => {
    const { onUpdateCaseInfo } = renderChecklist([familyContactItem()], {
      contactRestriction: { active: true, arrangementContactName: 'MICHAEL ELLISON' },
    });

    expect(screen.getByDisplayValue('KAREN ELLISON')).toBeInTheDocument();
    expect(screen.getByDisplayValue('(555) 201-4432')).toBeInTheDocument();
    // Rendering the warning writes nothing.
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('does not warn on an unrelated field group', () => {
    const certifier = item({
      index: 0,
      label: 'Certifier information',
      isDerived: true,
      requiredCaseFields: ['certifierName', 'certifierPhone'],
      requiredCaseFieldValues: { certifierName: 'DR. PATEL', certifierPhone: '(555) 777-1234' },
    });
    renderChecklist([certifier], { contactRestriction: { active: true, arrangementContactName: 'MICHAEL ELLISON' } });

    expect(screen.queryByText('Do not contact next of kin directly.')).not.toBeInTheDocument();
  });
});
