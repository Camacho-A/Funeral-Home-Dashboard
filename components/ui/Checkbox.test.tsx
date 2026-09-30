import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Checkbox } from './Checkbox';

/**
 * Task #14 Phase C (2026-09, SOLIS shared-component unification). No test
 * file existed for Checkbox before this phase — added alongside the new
 * :focus-visible treatment to protect click/checked/disabled/accessible-
 * name behavior going forward.
 */
describe('Checkbox', () => {
  it('7: fires onChange when clicked', () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} aria-label="Done" />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('reflects checked state via aria-checked', () => {
    render(<Checkbox checked aria-label="Done" />);
    expect(screen.getByRole('checkbox', { name: 'Done' })).toHaveAttribute('aria-checked', 'true');
  });

  it('a disabled checkbox does not fire onChange', () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} disabled aria-label="Done" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Done' });
    expect(checkbox).toBeDisabled();
    fireEvent.click(checkbox);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('requires and exposes a real accessible name', () => {
    render(<Checkbox checked={false} aria-label="Mark task complete" />);
    expect(screen.getByRole('checkbox', { name: 'Mark task complete' })).toBeInTheDocument();
  });

  it('renders both tones (brand/success) and both sizes (sm/md) without throwing', () => {
    for (const tone of ['brand', 'success'] as const) {
      for (const size of ['sm', 'md'] as const) {
        const { unmount } = render(<Checkbox checked={false} tone={tone} size={size} aria-label={`${tone}-${size}`} />);
        expect(screen.getByRole('checkbox', { name: `${tone}-${size}` })).toBeInTheDocument();
        unmount();
      }
    }
  });
});
