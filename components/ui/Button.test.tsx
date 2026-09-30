import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

/**
 * Task #14 Phase C (2026-09, SOLIS shared-component unification). No test
 * file existed for Button before this phase — added alongside the
 * variant/hover/focus changes to protect click/disabled/variant behavior
 * going forward.
 */
describe('Button', () => {
  it('1: fires onClick when clicked', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('2: a disabled button does not fire onClick and exposes the disabled attribute', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('3: the danger variant renders (destructive semantics reserved, no behavior change)', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('defaults to the primary variant', () => {
    const { container } = render(<Button>Create case</Button>);
    expect(container.querySelector('[class*="primary"]')).not.toBeNull();
  });

  it('the icon variant (Task #14 Phase C, new) renders with a caller-supplied accessible name', () => {
    render(
      <Button variant="icon" aria-label="Close">
        ×
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('type defaults to "button", never a form-submitting "submit"', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });
});
