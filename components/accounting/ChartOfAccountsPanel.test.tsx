import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChartOfAccountsPanel } from './ChartOfAccountsPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import * as accountingClient from '@/lib/accountingClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { LedgerAccount } from '@/types/ledgerAccount';

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

vi.mock('@/lib/accountingClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/accountingClient')>('@/lib/accountingClient');
  return { ...actual, fetchChartOfAccounts: vi.fn(), createLedgerAccount: vi.fn(), deactivateLedgerAccount: vi.fn() };
});

function makeAccount(overrides: Partial<LedgerAccount> = {}): LedgerAccount {
  return {
    id: 'account-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    accountNumber: '1000',
    accountNumberKey: `${DEFAULT_ORGANIZATION_ID}:1000`,
    name: 'Cash - Operating',
    accountType: 'asset',
    normalBalance: 'debit',
    parentAccountId: null,
    isSystemAccount: true,
    isActive: true,
    description: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <ChartOfAccountsPanel />
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

describe('ChartOfAccountsPanel — permission gating', () => {
  it("shows nothing to a role without accounting.view", async () => {
    mockPermissions([]);
    vi.mocked(accountingClient.fetchChartOfAccounts).mockResolvedValue([makeAccount()]);
    renderPanel();
    expect(await screen.findByText("You don't have access to the chart of accounts for this organization.")).toBeInTheDocument();
  });

  it('hides "+ New Account" for a role with view but not manage', async () => {
    mockPermissions(['accounting.view']);
    vi.mocked(accountingClient.fetchChartOfAccounts).mockResolvedValue([makeAccount()]);
    renderPanel();
    await screen.findByText('Cash - Operating');
    expect(screen.queryByRole('button', { name: '+ New Account' })).not.toBeInTheDocument();
  });

  it('shows "+ New Account" and allows creating one for a role with accounting.manage', async () => {
    mockPermissions(['accounting.view', 'accounting.manage']);
    vi.mocked(accountingClient.fetchChartOfAccounts).mockResolvedValue([makeAccount()]);
    vi.mocked(accountingClient.createLedgerAccount).mockResolvedValue(makeAccount({ id: 'account-2', accountNumber: '1300', name: 'Prepaid', isSystemAccount: false }));
    renderPanel();
    await screen.findByText('Cash - Operating');

    fireEvent.click(screen.getByRole('button', { name: '+ New Account' }));
    fireEvent.change(screen.getByPlaceholderText('Account number (e.g. 1300)'), { target: { value: '1300' } });
    fireEvent.change(screen.getByPlaceholderText('Account name'), { target: { value: 'Prepaid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(accountingClient.createLedgerAccount).toHaveBeenCalledWith(expect.objectContaining({ accountNumber: '1300', name: 'Prepaid' })));
  });
});
