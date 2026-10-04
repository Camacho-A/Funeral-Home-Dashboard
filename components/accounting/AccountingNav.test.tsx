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

  /**
   * Manors accounting/reports cleanup (2026-10). Chart of Accounts/
   * Journal Entries/Banking are now hidden for Manors specifically (via
   * the MANORS_ORGANIZATION_ID override in moduleVisibility.ts) — this
   * replaces the prior "renders the full sub-nav" expectation, which
   * described exactly the state this task changes. Dashboard/Invoices/
   * Reports remain, same as Reconciliation staying hidden.
   */
  it('renders only Dashboard/Invoices/Reports for Manors — Chart of Accounts/Journal Entries/Banking/Reconciliation are all hidden ("Manors\' real state")', async () => {
    mockPermissions = ['accounting.view'];
    vi.spyOn(organizationsService, 'get').mockResolvedValue({ id: DEFAULT_ORGANIZATION_ID, name: "Manor's Cremation", isActive: true });
    renderNav();
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Invoices')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
    // The organization-record query must actually resolve before the
    // negative assertions mean anything — querying immediately would
    // pass vacuously while it's still pending (isModuleHidden treats an
    // unloaded organization as "not hidden" by design, see its own
    // null-safety).
    await waitFor(() => expect(screen.queryByText('Chart of Accounts')).not.toBeInTheDocument());
    expect(screen.queryByText('Journal Entries')).not.toBeInTheDocument();
    expect(screen.queryByText('Banking')).not.toBeInTheDocument();
    expect(screen.queryByText('Reconciliation')).not.toBeInTheDocument();
  });

  it('an unrestricted organization (not Manors) still sees Chart of Accounts/Journal Entries/Banking — multi-tenant safety', async () => {
    mockPermissions = ['accounting.view'];
    vi.spyOn(organizationsService, 'get').mockResolvedValue({ id: 'some-other-organization', name: 'Evergreen Memorial Group', isActive: true });
    renderNav();
    await waitFor(() => expect(screen.getByText('Chart of Accounts')).toBeInTheDocument());
    expect(screen.getByText('Journal Entries')).toBeInTheDocument();
    expect(screen.getByText('Banking')).toBeInTheDocument();
    expect(screen.getByText('Invoices')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
    // Reconciliation is still hidden here too, but for the pre-existing,
    // unrelated reason (enabledModules not opted into) — not this task's
    // hiddenModules mechanism.
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
