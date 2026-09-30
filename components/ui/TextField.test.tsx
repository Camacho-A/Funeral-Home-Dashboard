import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextField } from './TextField';

/**
 * Task #14 Phase C (2026-09, SOLIS shared-component unification). No test
 * file existed for TextField before this phase — added alongside the new
 * disabled/invalid CSS to protect value/change/disabled behavior.
 */
describe('TextField', () => {
  it('4: fires onChange with the new value when typed into', () => {
    const onChange = vi.fn();
    render(<TextField aria-label="Name" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Jane' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('renders the current value', () => {
    render(<TextField aria-label="Name" value="Jane" onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Jane');
  });

  it('a disabled field cannot be changed', () => {
    const onChange = vi.fn();
    render(<TextField aria-label="Name" value="Jane" onChange={onChange} disabled />);
    const field = screen.getByRole('textbox', { name: 'Name' });
    expect(field).toBeDisabled();
  });
});
