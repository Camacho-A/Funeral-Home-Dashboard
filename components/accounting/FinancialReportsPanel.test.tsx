import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinancialReportsPanel } from './FinancialReportsPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import * as accountingClient from '@/lib/accountingClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { LedgerAccount } from '@/types/ledgerAccount';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

vi.mock('@/lib/accountingClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/accountingClient')>('@/lib/accountingClient');
  return {
    ...actual,
    fetchChartOfAccounts: vi.fn(),
    fetchTrialBalanceReport: vi.fn(),
    fetchBalanceSheetReport: vi.fn(),
    fetchProfitAndLossReport: vi.fn(),
    fetchTransactionRegisterReport: vi.fn(),
    fetchGeneralLedgerReport: vi.fn(),
  };
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

function renderPanel(reportType: Parameters<typeof FinancialReportsPanel>[0]['reportType']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <FinancialReportsPanel reportType={reportType} />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

function mockPermissions(permissions: string[]) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions });
}

function mockAllReportsEmpty() {
  vi.mocked(accountingClient.fetchChartOfAccounts).mockResolvedValue([makeAccount()]);
  vi.mocked(accountingClient.fetchTrialBalanceReport).mockResolvedValue({ rows: [], totalDebits: 0, totalCredits: 0 });
  vi.mocked(accountingClient.fetchBalanceSheetReport).mockResolvedValue({
    asOfDate: null,
    assets: [],
    liabilities: [],
    equity: [],
    netIncome: 0,
    totalAssets: 0,
    totalLiabilitiesAndEquity: 0,
  });
  vi.mocked(accountingClient.fetchProfitAndLossReport).mockResolvedValue({
    fromDate: null,
    toDate: null,
    revenue: [],
    expenses: [],
    totalRevenue: 0,
    totalExpenses: 0,
    netIncome: 0,
  });
  vi.mocked(accountingClient.fetchTransactionRegisterReport).mockResolvedValue({ rows: [] });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('FinancialReportsPanel — permission gating', () => {
  it('shows nothing to a role without accounting.report', async () => {
    mockPermissions([]);
    mockAllReportsEmpty();
    renderPanel('trial-balance');
    expect(await screen.findByText("You don't have access to financial reports for this organization.")).toBeInTheDocument();
  });

  it('renders trial balance totals for a role with accounting.report', async () => {
    mockPermissions(['accounting.report']);
    vi.mocked(accountingClient.fetchChartOfAccounts).mockResolvedValue([makeAccount()]);
    vi.mocked(accountingClient.fetchTrialBalanceReport).mockResolvedValue({
      rows: [{ accountId: 'account-1', accountNumber: '1000', accountName: 'Cash - Operating', accountType: 'asset', debitTotal: 50000, creditTotal: 0 }],
      totalDebits: 50000,
      totalCredits: 50000,
    });
    renderPanel('trial-balance');
    expect(await screen.findByText('1000 — Cash - Operating')).toBeInTheDocument();
    expect(screen.getAllByText('$500.00').length).toBeGreaterThan(0);
  });

  it('renders the transaction register empty state', async () => {
    mockPermissions(['accounting.report']);
    mockAllReportsEmpty();
    renderPanel('transaction-register');
    expect(await screen.findByText('No transactions have been posted yet.')).toBeInTheDocument();
  });
});
