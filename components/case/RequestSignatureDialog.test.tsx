import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RequestSignatureDialog } from './RequestSignatureDialog';
import * as signatureRequestsClient from '@/lib/signatureRequestsClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { SignatureRequest } from '@/types/signatureRequest';

vi.mock('@/lib/signatureRequestsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/signatureRequestsClient')>('@/lib/signatureRequestsClient');
  return { ...actual, createSignatureRequest: vi.fn() };
});

function makeRequest(overrides: Partial<SignatureRequest> = {}): SignatureRequest {
  return {
    id: 'sigreq-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    documentId: 'doc-1',
    documentVersion: 1,
    signerName: 'Jane Doe',
    signerEmail: 'jane@example.com',
    signerRole: 'next_of_kin',
    status: 'draft',
    tokenHash: 'hash',
    issuedAt: '2026-08-14T00:00:00.000Z',
    expiresAt: null,
    requestVersion: 1,
    sequenceOrder: 1,
    requestedBy: 'identity-1',
    viewedAt: null,
    signedAt: null,
    declinedAt: null,
    declineReason: null,
    cancelledAt: null,
    cancelledBy: null,
    lastRemindedAt: null,
    reminderCount: 0,
    correlationId: 'corr-1',
    ...overrides,
  };
}

function renderDialog(props: Partial<Parameters<typeof RequestSignatureDialog>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RequestSignatureDialog open onClose={onClose} organizationId={DEFAULT_ORGANIZATION_ID} caseId="case-1" documentId="doc-1" {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('RequestSignatureDialog', () => {
  it('disables Send until both signer name and email are filled in', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Signer name'), { target: { value: 'Jane Doe' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Signer email'), { target: { value: 'jane@example.com' } });
    expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled();
  });

  it('defaults the signer role to Next of Kin', () => {
    renderDialog();
    expect(screen.getByLabelText('Signer role')).toHaveValue('next_of_kin');
  });

  it('sends the request with the chosen fields and closes on success', async () => {
    vi.mocked(signatureRequestsClient.createSignatureRequest).mockResolvedValue(makeRequest());
    const { onClose } = renderDialog();

    fireEvent.change(screen.getByLabelText('Signer name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText('Signer email'), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText('Signer role'), { target: { value: 'funeral_director' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(signatureRequestsClient.createSignatureRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: DEFAULT_ORGANIZATION_ID,
          caseId: 'case-1',
          documentId: 'doc-1',
          signerName: 'Jane Doe',
          signerEmail: 'jane@example.com',
          signerRole: 'funeral_director',
          expiresAt: undefined,
        }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows an inline error rather than closing the dialog when the request fails (e.g. an active request already exists)', async () => {
    vi.mocked(signatureRequestsClient.createSignatureRequest).mockRejectedValue(new Error('An active signature request already exists for this document.'));
    const { onClose } = renderDialog();

    fireEvent.change(screen.getByLabelText('Signer name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText('Signer email'), { target: { value: 'jane@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('An active signature request already exists for this document.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('resets its fields each time it is reopened', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <RequestSignatureDialog open onClose={onClose} organizationId={DEFAULT_ORGANIZATION_ID} caseId="case-1" documentId="doc-1" />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Signer name'), { target: { value: 'Jane Doe' } });

    rerender(
      <QueryClientProvider client={queryClient}>
        <RequestSignatureDialog open={false} onClose={onClose} organizationId={DEFAULT_ORGANIZATION_ID} caseId="case-1" documentId="doc-1" />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <RequestSignatureDialog open onClose={onClose} organizationId={DEFAULT_ORGANIZATION_ID} caseId="case-1" documentId="doc-1" />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText('Signer name')).toHaveValue('');
    expect(screen.getByLabelText('Signer email')).toHaveValue('');
  });
});
