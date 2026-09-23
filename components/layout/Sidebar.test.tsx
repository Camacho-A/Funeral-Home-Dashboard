import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import { organizationsService } from '@/services/organizationsService';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn(), fetchActiveStaffCount: vi.fn() };
});

vi.spyOn(organizationsService, 'get').mockResolvedValue({
  id: DEFAULT_ORGANIZATION_ID,
  name: 'Manors Cremation',
  isActive: true,
});

function mockPermissions(permissions: string[] = []) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions });
}

function renderSidebar(authAdapterMode?: 'mock' | 'wix' | 'identity') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <Sidebar authAdapterMode={authAdapterMode} />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('Sidebar "N staff online"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the real fetched count, not a hardcoded value, for the current organization', async () => {
    mockPermissions();
    vi.mocked(identityAuthClient.fetchActiveStaffCount).mockResolvedValue(5);
    renderSidebar('identity');
    expect(await screen.findByText('5 staff online')).toBeInTheDocument();
    expect(identityAuthClient.fetchActiveStaffCount).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID);
  });

  it('renders "0 staff online" for zero active staff', async () => {
    mockPermissions();
    vi.mocked(identityAuthClient.fetchActiveStaffCount).mockResolvedValue(0);
    renderSidebar('identity');
    expect(await screen.findByText('0 staff online')).toBeInTheDocument();
  });

  it('renders "1 staff online" for one active staff member', async () => {
    mockPermissions();
    vi.mocked(identityAuthClient.fetchActiveStaffCount).mockResolvedValue(1);
    renderSidebar('identity');
    expect(await screen.findByText('1 staff online')).toBeInTheDocument();
  });

  it('renders "2 staff online" for multiple active staff', async () => {
    mockPermissions();
    vi.mocked(identityAuthClient.fetchActiveStaffCount).mockResolvedValue(2);
    renderSidebar('identity');
    expect(await screen.findByText('2 staff online')).toBeInTheDocument();
  });

  it('does not fetch or render any staff-online count outside identity mode', async () => {
    mockPermissions();
    renderSidebar('mock');
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(identityAuthClient.fetchActiveStaffCount).not.toHaveBeenCalled();
    expect(screen.queryByText(/staff online/)).not.toBeInTheDocument();
  });

  it('does not fetch or render any staff-online count when authAdapterMode is omitted', async () => {
    mockPermissions();
    renderSidebar(undefined);
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(identityAuthClient.fetchActiveStaffCount).not.toHaveBeenCalled();
    expect(screen.queryByText(/staff online/)).not.toBeInTheDocument();
  });
});
