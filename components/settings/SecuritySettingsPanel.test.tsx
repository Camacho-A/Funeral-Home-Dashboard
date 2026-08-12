import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SecuritySettingsPanel } from './SecuritySettingsPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import * as identityProfileClient from '@/lib/identityProfileClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchActiveSessions: vi.fn(), revokeSessionById: vi.fn(), signOutEverywhere: vi.fn(), changePassword: vi.fn() };
});

vi.mock('@/lib/identityProfileClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityProfileClient')>('@/lib/identityProfileClient');
  return { ...actual, fetchMyIdentityProfile: vi.fn(), updateMyPhone: vi.fn() };
});

function renderPanel() {
  vi.mocked(identityAuthClient.fetchActiveSessions).mockResolvedValue([]);
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <SecuritySettingsPanel />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('SecuritySettingsPanel — Profile (Phase 33)', () => {
  it('renders an empty phone field when no phone is on file', async () => {
    vi.mocked(identityProfileClient.fetchMyIdentityProfile).mockResolvedValue(null);
    renderPanel();
    const field = await screen.findByLabelText('Phone number');
    expect(field).toHaveValue('');
  });

  it('pre-fills the phone field with the existing phone number', async () => {
    vi.mocked(identityProfileClient.fetchMyIdentityProfile).mockResolvedValue({
      id: 'identity-1',
      email: 'x@example.com',
      normalizedEmail: 'x@example.com',
      displayName: 'X',
      phone: '+15555550100',
      status: 'active',
      emailVerified: true,
      passwordVersion: 1,
      mfaEnabled: false,
      lastLoginAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    renderPanel();
    const field = await screen.findByLabelText('Phone number');
    await waitFor(() => expect(field).toHaveValue('+15555550100'));
  });

  it('saves the phone number and shows a success message', async () => {
    vi.mocked(identityProfileClient.fetchMyIdentityProfile).mockResolvedValue(null);
    vi.mocked(identityProfileClient.updateMyPhone).mockResolvedValue({
      id: 'identity-1',
      email: 'x@example.com',
      normalizedEmail: 'x@example.com',
      displayName: 'X',
      phone: '+15555550100',
      status: 'active',
      emailVerified: true,
      passwordVersion: 1,
      mfaEnabled: false,
      lastLoginAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    renderPanel();
    const field = await screen.findByLabelText('Phone number');
    fireEvent.change(field, { target: { value: '+15555550100' } });
    fireEvent.click(screen.getByRole('button', { name: /save phone number/i }));

    await waitFor(() => expect(identityProfileClient.updateMyPhone).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, '+15555550100'));
    expect(await screen.findByText('Phone number saved.')).toBeInTheDocument();
  });

  it('saves null when the field is cleared to blank', async () => {
    vi.mocked(identityProfileClient.fetchMyIdentityProfile).mockResolvedValue(null);
    vi.mocked(identityProfileClient.updateMyPhone).mockResolvedValue({
      id: 'identity-1',
      email: 'x@example.com',
      normalizedEmail: 'x@example.com',
      displayName: 'X',
      phone: null,
      status: 'active',
      emailVerified: true,
      passwordVersion: 1,
      mfaEnabled: false,
      lastLoginAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    renderPanel();
    const field = await screen.findByLabelText('Phone number');
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /save phone number/i }));
    await waitFor(() => expect(identityProfileClient.updateMyPhone).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, null));
  });

  it('shows an error message when saving fails', async () => {
    vi.mocked(identityProfileClient.fetchMyIdentityProfile).mockResolvedValue(null);
    vi.mocked(identityProfileClient.updateMyPhone).mockRejectedValue(new Error('phone must be a plausible phone number string or null.'));
    renderPanel();
    const field = await screen.findByLabelText('Phone number');
    fireEvent.change(field, { target: { value: 'not-a-phone' } });
    fireEvent.click(screen.getByRole('button', { name: /save phone number/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/plausible phone number/i);
  });
});
