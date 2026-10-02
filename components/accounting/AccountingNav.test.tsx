import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountingNav } from './AccountingNav';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { organizationsService } from '@/services/organizationsService';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

/**
 * Manors go-live hardening. Production testing showed this nav rendered
 * its labels (Dashboard/Chart of Accounts/Journal Entries/Banking/
 * Reconciliation/Invoices/Reports) regardless of permission, even though
 * the accounting data underneath was already correctly 403'd — a
 * page-structure leak this test guards against directly.
 */
vi.mock('next/navigation', () => ({ usePathname: () => '/accounting' }));

let mockPermissions: string[] = [];
vi.mock('@/hooks/useRbac', () => ({
  useMyPermissions: () => ({ data: { identityId: 'identity-test', roleKey: 'test', permissions: mockPermissions }, isPending: false }),
}));

function renderNav() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <AccountingNav />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('AccountingNav — authorization guard (Manors go-live hardening)', () => {
  it('renders nothing for a caller lacking accounting.view', () => {
    mockPermissions = ['case.read', 'case.create', 'case.update'];
    const { container } = renderNav();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Chart of Accounts')).not.toBeInTheDocument();
    expect(screen.queryByText('Journal Entries')).not.toBeInTheDocument();
  });

  it('renders the full sub-nav, except Reconciliation, for a caller with accounting.view when the organization has not enabled the reconciliation module (Manors\' real state)', async () => {
    mockPermissions = ['accounting.view'];
    vi.spyOn(organizationsService, 'get').mockResolvedValue({ id: DEFAULT_ORGANIZATION_ID, name: "Manor's Cremation", isActive: true });
    renderNav();
    await waitFor(() => expect(screen.getByText('Chart of Accounts')).toBeInTheDocument());
    expect(screen.getByText('Journal Entries')).toBeInTheDocument();
    expect(screen.getByText('Banking')).toBeInTheDocument();
    expect(screen.getByText('Invoices')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.queryByText('Reconciliation')).not.toBeInTheDocument();
  });

  /**
   * Manors branding/visibility follow-up (2026-10). Reconciliation is the
   * one link additionally gated on the `reconciliation` module — every
   * other link in this nav is unaffected by module configuration.
   */
  it('renders Reconciliation once the organization has enabled the reconciliation module', async () => {
    mockPermissions = ['accounting.view'];
    vi.spyOn(organizationsService, 'get').mockResolvedValue({
      id: DEFAULT_ORGANIZATION_ID,
      name: "Manor's Cremation",
      isActive: true,
      enabledModules: ['reconciliation'],
    });
    renderNav();
    expect(await screen.findByText('Reconciliation')).toBeInTheDocument();
  });
});
