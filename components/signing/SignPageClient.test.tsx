import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SignPageClient } from './SignPageClient';
import * as signingClient from '@/lib/signingClient';
import type { SigningPageContext } from '@/lib/signingClient';

vi.mock('@/lib/signingClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/signingClient')>('@/lib/signingClient');
  return { ...actual, fetchSigningPageContext: vi.fn(), completeSigning: vi.fn(), declineSigning: vi.fn() };
});

function makeContext(overrides: Partial<SigningPageContext> = {}): SigningPageContext {
  return {
    status: 'pending',
    signerName: 'Jane Doe',
    signerRole: 'next_of_kin',
    expiresAt: null,
    documentFileName: 'Cremation Authorization.pdf',
    documentTypeKey: 'authorization.cremation',
    decedentName: 'Robert Ellison',
    organizationName: "Manor's Cremation",
    ...overrides,
  };
}

function renderPage(token = 'raw-token-abc') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SignPageClient token={token} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('SignPageClient — resolving the token', () => {
  it('shows an inline error, never a generic crash, when the token is invalid or expired', async () => {
    vi.mocked(signingClient.fetchSigningPageContext).mockRejectedValue(new Error('This signing link is invalid or has expired.'));
    renderPage();
    expect(await screen.findByText('This signing link is invalid or has expired.')).toBeInTheDocument();
  });

  it('shows the document, decedent, and organization context once resolved', async () => {
    vi.mocked(signingClient.fetchSigningPageContext).mockResolvedValue(makeContext());
    renderPage();
    expect(await screen.findByText('Cremation Authorization.pdf')).toBeInTheDocument();
    expect(screen.getByText(/Manor's Cremation/)).toBeInTheDocument();
    expect(screen.getByText(/Robert Ellison/)).toBeInTheDocument();
  });
});

describe('SignPageClient — terminal states never show a signing form', () => {
  it.each(['signed', 'declined', 'expired', 'cancelled'])('shows a status message instead of the form when status is "%s"', async (status) => {
    vi.mocked(signingClient.fetchSigningPageContext).mockResolvedValue(makeContext({ status }));
    renderPage();
    await screen.findByText('Cremation Authorization.pdf');
    expect(screen.queryByLabelText('Type your full name to sign')).not.toBeInTheDocument();
  });
});

describe('SignPageClient — signing', () => {
  it('disables Sign until a name is typed and consent is checked', async () => {
    vi.mocked(signingClient.fetchSigningPageContext).mockResolvedValue(makeContext());
    renderPage();
    await screen.findByLabelText('Type your full name to sign');
    expect(screen.getByRole('button', { name: 'Sign' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Type your full name to sign'), { target: { value: 'Jane Doe' } });
    expect(screen.getByRole('button', { name: 'Sign' })).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Sign' })).not.toBeDisabled();
  });

  it('submits the typed name/initials/consent and shows a confirmation on success', async () => {
    vi.mocked(signingClient.fetchSigningPageContext).mockResolvedValue(makeContext());
    vi.mocked(signingClient.completeSigning).mockResolvedValue({ status: 'signed', signedAt: '2026-08-14T03:00:00.000Z' });
    renderPage('raw-token-abc');
    await screen.findByLabelText('Type your full name to sign');

    fireEvent.change(screen.getByLabelText('Type your full name to sign'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText('Initials (optional)'), { target: { value: 'JD' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));

    await waitFor(() =>
      expect(signingClient.completeSigning).toHaveBeenCalledWith('raw-token-abc', { signedName: 'Jane Doe', initials: 'JD', consentAcknowledged: true }),
    );
    expect(await screen.findByText(/Thank you, Jane Doe/)).toBeInTheDocument();
  });

  it('shows an inline error, not a crash, when signing fails (e.g. replaying an already-terminal request)', async () => {
    vi.mocked(signingClient.fetchSigningPageContext).mockResolvedValue(makeContext());
    vi.mocked(signingClient.completeSigning).mockRejectedValue(new Error('This signature request can no longer be completed.'));
    renderPage();
    await screen.findByLabelText('Type your full name to sign');

    fireEvent.change(screen.getByLabelText('Type your full name to sign'), { target: { value: 'Jane Doe' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));

    expect(await screen.findByText('This signature request can no longer be completed.')).toBeInTheDocument();
  });
});

describe('SignPageClient — declining', () => {
  it('requires an explicit second confirmation before submitting a decline', async () => {
    vi.mocked(signingClient.fetchSigningPageContext).mockResolvedValue(makeContext());
    vi.mocked(signingClient.declineSigning).mockResolvedValue({ status: 'declined' });
    renderPage('raw-token-abc');
    await screen.findByLabelText('Type your full name to sign');

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(signingClient.declineSigning).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Disagrees with terms' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decline' }));

    await waitFor(() => expect(signingClient.declineSigning).toHaveBeenCalledWith('raw-token-abc', { reason: 'Disagrees with terms' }));
    expect(await screen.findByText(/You.ve declined to sign/)).toBeInTheDocument();
  });
});
