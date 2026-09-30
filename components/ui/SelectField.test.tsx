import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectField } from './SelectField';

/**
 * Task #14 Phase C (2026-09, SOLIS shared-component unification). No test
 * file existed for SelectField before this phase.
 */
describe('SelectField', () => {
  it('5: fires onChange with the selected value', () => {
    const onChange = vi.fn();
    render(
      <SelectField aria-label="Role" value="staff" onChange={onChange}>
        <option value="staff">Staff</option>
        <option value="admin">Admin</option>
      </SelectField>,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'admin' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('renders the selected value', () => {
    render(
      <SelectField aria-label="Role" value="admin" onChange={() => {}}>
        <option value="staff">Staff</option>
        <option value="admin">Admin</option>
      </SelectField>,
    );
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveValue('admin');
  });

  it('a disabled select cannot be changed', () => {
    render(
      <SelectField aria-label="Role" value="staff" onChange={() => {}} disabled>
        <option value="staff">Staff</option>
      </SelectField>,
    );
    expect(screen.getByRole('combobox', { name: 'Role' })).toBeDisabled();
  });
});
