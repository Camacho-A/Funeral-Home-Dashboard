import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ArchiveCaseSection } from './ArchiveCaseSection';

const baseProps = {
  isArchived: false,
  caseNumber: 'B2026-035',
  decedentName: 'EVARISTA SILVA RIVERO',
  onChange: () => {},
};

describe('ArchiveCaseSection', () => {
  it('offers an archive action on an active case', () => {
    render(<ArchiveCaseSection {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Archive case' })).toBeEnabled();
    expect(screen.getByText(/Nothing is deleted/)).toBeInTheDocument();
  });

  it('requires confirmation and saves nothing until confirmed', () => {
    const onChange = vi.fn();
    render(<ArchiveCaseSection {...baseProps} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Archive case' }));
    expect(onChange).not.toHaveBeenCalled();

    const dialog = within(screen.getByRole('dialog'));
    // Names the actual case, so staff confirm a fact rather than an abstraction.
    expect(dialog.getByText('EVARISTA SILVA RIVERO')).toBeInTheDocument();
    expect(dialog.getByText('B2026-035', { exact: false })).toBeInTheDocument();

    fireEvent.click(dialog.getByRole('button', { name: 'Archive case' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('says plainly that archiving deletes nothing', () => {
    // "Archive" next to a funeral case can read as "delete" to someone who
    // has never used it. The dialog has to rule that out explicitly.
    render(<ArchiveCaseSection {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive case' }));
    const dialog = within(screen.getByRole('dialog'));

    expect(dialog.getByText(/Nothing is deleted/)).toBeInTheDocument();
    expect(dialog.getByText(/checklist, documents, payments and activity history are all kept/)).toBeInTheDocument();
    expect(dialog.getByText(/restore the case at any time/)).toBeInTheDocument();
  });

  it('cancelling leaves the case active', () => {
    const onChange = vi.fn();
    render(<ArchiveCaseSection {...baseProps} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Archive case' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Archive case' })).toBeInTheDocument();
  });

  it('an archived case shows its state and a one-click restore, with no confirmation', () => {
    const onChange = vi.fn();
    render(<ArchiveCaseSection {...baseProps} isArchived onChange={onChange} />);

    expect(screen.getByText('This case is archived')).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been deleted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive case' })).not.toBeInTheDocument();

    // Restoring just puts a case back where staff expect it — no dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Restore case' }));
    expect(onChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('disables the actions while a change is in flight', () => {
    const { rerender } = render(<ArchiveCaseSection {...baseProps} pending />);
    expect(screen.getByRole('button', { name: 'Archive case' })).toBeDisabled();

    rerender(<ArchiveCaseSection {...baseProps} isArchived pending />);
    expect(screen.getByRole('button', { name: 'Restoring…' })).toBeDisabled();
  });

  it('read-only callers get no archive control, but still see the archived state', () => {
    const { rerender } = render(<ArchiveCaseSection {...baseProps} readOnly />);
    expect(screen.queryByRole('button', { name: 'Archive case' })).not.toBeInTheDocument();

    rerender(<ArchiveCaseSection {...baseProps} isArchived readOnly />);
    expect(screen.getByText('This case is archived')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore case' })).not.toBeInTheDocument();
  });
});
