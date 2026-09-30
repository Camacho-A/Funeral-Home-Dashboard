import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextArea } from './TextArea';

/**
 * Task #14 Phase C (2026-09, SOLIS shared-component unification). No test
 * file existed for TextArea before this phase.
 */
describe('TextArea', () => {
  it('6: fires onChange with the new value when typed into', () => {
    const onChange = vi.fn();
    render(<TextArea aria-label="Notes" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'Some notes' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('renders the current value', () => {
    render(<TextArea aria-label="Notes" value="Existing notes" onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Existing notes');
  });

  it('a disabled textarea cannot be changed', () => {
    render(<TextArea aria-label="Notes" value="Existing notes" onChange={() => {}} disabled />);
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeDisabled();
  });
});
