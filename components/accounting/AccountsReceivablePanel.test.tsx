import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountsReceivablePanel } from './AccountsReceivablePanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import * as accountingClient from '@/lib/accountingClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

vi.mock('@/lib/accountingClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/accountingClient')>('@/lib/accountingClient');
  return { ...actual, fetchArAgingReport: vi.fn() };
});

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <AccountsReceivablePanel />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

function mockPermissions(permissions: string[]) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('AccountsReceivablePanel — permission gating', () => {
  it('shows nothing to a role without accounting.report', async () => {
    mockPermissions([]);
    vi.mocked(accountingClient.fetchArAgingReport).mockResolvedValue({
      rows: [{ caseId: 'case-1', caseOrderId: 'order-1', balanceDue: 10000, anchorDate: '2026-07-01T00:00:00.000Z', ageDays: 37, bucket: '31-60' }],
      totalOutstanding: 10000,
      glAccountsReceivableBalance: 10000,
      reconciles: true,
    });
    renderPanel();
    expect(await screen.findByText("You don't have access to accounts receivable for this organization.")).toBeInTheDocument();
  });

  it('shows an empty state when there are no open balances', async () => {
    mockPermissions(['accounting.report']);
    vi.mocked(accountingClient.fetchArAgingReport).mockResolvedValue({ rows: [], totalOutstanding: 0, glAccountsReceivableBalance: 0, reconciles: true });
    renderPanel();
    expect(await screen.findByText('No open balances — every case is fully paid.')).toBeInTheDocument();
  });

  it('renders aging rows and the GL reconciliation badge for a role with accounting.report', async () => {
    mockPermissions(['accounting.report']);
    vi.mocked(accountingClient.fetchArAgingReport).mockResolvedValue({
      rows: [{ caseId: 'case-1', caseOrderId: 'order-1', balanceDue: 10000, anchorDate: '2026-07-01T00:00:00.000Z', ageDays: 37, bucket: '31-60' }],
      totalOutstanding: 10000,
      glAccountsReceivableBalance: 10000,
      reconciles: true,
    });
    renderPanel();
    expect(await screen.findByText('Case case-1')).toBeInTheDocument();
    expect(screen.getAllByText('$100.00')).toHaveLength(2);
    expect(screen.getByText('Matches GL')).toBeInTheDocument();
  });

  it('flags a non-reconciling report', async () => {
    mockPermissions(['accounting.report']);
    vi.mocked(accountingClient.fetchArAgingReport).mockResolvedValue({
      rows: [{ caseId: 'case-1', caseOrderId: 'order-1', balanceDue: 10000, anchorDate: '2026-07-01T00:00:00.000Z', ageDays: 37, bucket: '31-60' }],
      totalOutstanding: 10000,
      glAccountsReceivableBalance: 9000,
      reconciles: false,
    });
    renderPanel();
    expect(await screen.findByText('Does not match GL')).toBeInTheDocument();
  });
});
