import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReconciliationPage from './page';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { organizationsService } from '@/services/organizationsService';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

vi.mock('next/navigation', () => ({ usePathname: () => '/accounting/reconciliation' }));
vi.mock('@/hooks/useRbac', () => ({
  useMyPermissions: () => ({ data: { identityId: 'identity-test', roleKey: 'test', permissions: ['accounting.view'] }, isPending: false }),
}));
vi.mock('@/components/accounting/ReconciliationPanel', () => ({
  ReconciliationPanel: () => <div>REAL RECONCILIATION PANEL</div>,
}));

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <ReconciliationPage />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

/**
 * Manors branding/visibility follow-up (2026-10). Direct-URL access must
 * follow the same disabled-module behavior as the hidden nav link — a
 * Manors staff member who bookmarks/types this URL sees a clear "not
 * enabled" message, never the real panel, regardless of their own
 * permissions (an administrator here still gets the disabled message).
 */
describe('ReconciliationPage — module visibility', () => {
  it('shows a "not enabled" message instead of the real panel when the organization has not enabled the reconciliation module', async () => {
    vi.spyOn(organizationsService, 'get').mockResolvedValue({ id: DEFAULT_ORGANIZATION_ID, name: "Manor's Cremation", isActive: true });
    renderPage();
    expect(await screen.findByText('Reconciliation is not enabled for this organization.')).toBeInTheDocument();
    expect(screen.queryByText('REAL RECONCILIATION PANEL')).not.toBeInTheDocument();
  });

  it('renders the real panel once the organization has enabled the reconciliation module', async () => {
    vi.spyOn(organizationsService, 'get').mockResolvedValue({
      id: DEFAULT_ORGANIZATION_ID,
      name: "Manor's Cremation",
      isActive: true,
      enabledModules: ['reconciliation'],
    });
    renderPage();
    expect(await screen.findByText('REAL RECONCILIATION PANEL')).toBeInTheDocument();
    expect(screen.queryByText('Reconciliation is not enabled for this organization.')).not.toBeInTheDocument();
  });
});
