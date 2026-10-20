import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { CremainsPickupError } from '@/lib/cremainsPickupClient';
import { ExpectedPickupDateEditor } from './ExpectedPickupDateEditor';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('@/hooks/useCremainsPickup', () => ({
  useUpdateExpectedPickupDate: () => ({ mutateAsync, isPending: false }),
}));

function renderEditor() {
  render(
    <ExpectedPickupDateEditor organizationId={DEFAULT_ORGANIZATION_ID} caseId="case-1" expectedDate="2026-10-16" organizationToday="2026-10-15" />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit date' }));
}

describe('ExpectedPickupDateEditor', () => {
  it('saves a new expected date through the pickup endpoint', async () => {
    mutateAsync.mockResolvedValueOnce({});
    renderEditor();
    fireEvent.change(screen.getByLabelText('Expected Pickup Date'), { target: { value: '2026-10-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Date' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ expectedDate: '2026-10-20', reason: null }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the dialog open and explains a refusal', async () => {
    mutateAsync.mockRejectedValueOnce(new CremainsPickupError('A reason is required for this date.', true, 422));
    renderEditor();
    fireEvent.change(screen.getByLabelText('Expected Pickup Date'), { target: { value: '2026-10-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Date' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A reason is required for this date.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
