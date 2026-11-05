import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';

/**
 * Task #14 Phase C (2026-09, SOLIS shared-component unification). No test
 * file existed for Modal before this phase — added alongside the new
 * shadow-only CSS change to confirm its existing close/action behavior
 * (13: "Modal actions remain unchanged") was not disturbed.
 */
describe('Modal', () => {
  it('does not render when closed', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Example">
        content
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders its children and accessible name when open', () => {
    render(
      <Modal open onClose={() => {}} title="Example">
        <p>content</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Example' })).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Example">
        content
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the overlay calls onClose', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Example">
        content
      </Modal>,
    );
    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking inside the panel does not call onClose', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Example">
        <p>content</p>
      </Modal>,
    );
    fireEvent.click(screen.getByText('content'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("size: 'md' and 'lg' keep their own panels; 'xl' (2026-11, fax review) is the lg layout plus its own width and height", () => {
    const classesFor = (size?: 'md' | 'lg' | 'xl') => {
      const { unmount } = render(
        <Modal open onClose={() => {}} title={`Example ${size ?? 'default'}`} size={size}>
          content
        </Modal>,
      );
      const classes = screen.getByRole('dialog').className.split(/\s+/).filter(Boolean);
      unmount();
      return classes;
    };
    const md = classesFor();
    const lg = classesFor('lg');
    const xl = classesFor('xl');
    expect(classesFor('md')).toEqual(md);
    expect(md).toHaveLength(1);
    expect(lg).toHaveLength(2);
    expect(lg).toEqual(expect.arrayContaining(md));
    expect(xl).toHaveLength(3);
    expect(xl).toEqual(expect.arrayContaining(lg));
  });
});
