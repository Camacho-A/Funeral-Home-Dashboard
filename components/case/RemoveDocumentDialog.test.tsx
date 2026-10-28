import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoveDocumentDialog } from './RemoveDocumentDialog';

describe('RemoveDocumentDialog (2026-10)', () => {
  it('Remove stays disabled until a reason is chosen; "Other" needs details', async () => {
    const onConfirm = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<RemoveDocumentDialog fileName="REYNOLDS PERMIT.pdf" onClose={onClose} onConfirm={onConfirm} />);

    expect(screen.getByText(/is not\s+deleted/)).toBeTruthy();
    const remove = screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Other'));
    expect(remove.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'scan unreadable' } });
    expect(remove.disabled).toBe(false);

    fireEvent.click(screen.getByLabelText('Duplicate'));
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: '' } });
    fireEvent.click(remove);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ reason: 'duplicate', note: null }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows the server refusal and stays open', async () => {
    const onClose = vi.fn();
    render(<RemoveDocumentDialog fileName="a.pdf" onClose={onClose} onConfirm={async () => { throw new Error('Only an administrator can remove a document.'); }} />);
    fireEvent.click(screen.getByLabelText('Wrong document'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Only an administrator can remove a document.')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
