import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountingDashboardPanel } from './AccountingDashboardPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import * as accountingClient from '@/lib/accountingClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { JournalEntry } from '@/types/journalEntry';

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

vi.mock('@/lib/accountingClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/accountingClient')>('@/lib/accountingClient');
  return {
    ...actual,
    fetchBalanceSheetReport: vi.fn(),
    fetchArAgingReport: vi.fn(),
    fetchJournalEntries: vi.fn(),
  };
});

function makeEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 'entry-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    entryNumber: 'JE-000001',
    entryNumberKey: `${DEFAULT_ORGANIZATION_ID}:JE-000001`,
    entryDate: '2026-08-01T00:00:00.000Z',
    status: 'draft',
    sourceType: 'manual',
    sourceReferenceId: null,
    caseId: null,
    memo: 'Draft entry awaiting review',
    reversesEntryId: null,
    postedAt: null,
    postedByStaffProfileId: null,
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
        <AccountingDashboardPanel />
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

describe('AccountingDashboardPanel — permission gating', () => {
  it('shows nothing to a role without accounting.view', async () => {
    mockPermissions([]);
    vi.mocked(accountingClient.fetchBalanceSheetReport).mockResolvedValue({
      asOfDate: null,
      assets: [{ accountId: 'account-1', accountNumber: '1000', accountName: 'Cash', amount: 100000 }],
      liabilities: [],
      equity: [],
      netIncome: 0,
      totalAssets: 100000,
      totalLiabilitiesAndEquity: 100000,
    });
    vi.mocked(accountingClient.fetchArAgingReport).mockResolvedValue({ rows: [], totalOutstanding: 25000, glAccountsReceivableBalance: 25000, reconciles: true });
    vi.mocked(accountingClient.fetchJournalEntries).mockResolvedValue([makeEntry()]);
    renderPanel();
    expect(await screen.findByText("You don't have access to the accounting dashboard for this organization.")).toBeInTheDocument();
  });

  it('shows cash position, open AR, and pending drafts for a role with accounting.view', async () => {
    mockPermissions(['accounting.view']);
    vi.mocked(accountingClient.fetchBalanceSheetReport).mockResolvedValue({
      asOfDate: null,
      assets: [{ accountId: 'account-1', accountNumber: '1000', accountName: 'Cash', amount: 100000 }],
      liabilities: [],
      equity: [],
      netIncome: 0,
      totalAssets: 100000,
      totalLiabilitiesAndEquity: 100000,
    });
    vi.mocked(accountingClient.fetchArAgingReport).mockResolvedValue({ rows: [], totalOutstanding: 25000, glAccountsReceivableBalance: 25000, reconciles: true });
    vi.mocked(accountingClient.fetchJournalEntries).mockResolvedValue([makeEntry()]);
    renderPanel();

    expect(await screen.findByText('$1000.00')).toBeInTheDocument();
    expect(screen.getByText('$250.00')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Draft entry awaiting review')).toBeInTheDocument();
  });

  it('shows an empty state when there are no drafts pending review', async () => {
    mockPermissions(['accounting.view']);
    vi.mocked(accountingClient.fetchBalanceSheetReport).mockResolvedValue({
      asOfDate: null,
      assets: [],
      liabilities: [],
      equity: [],
      netIncome: 0,
      totalAssets: 0,
      totalLiabilitiesAndEquity: 0,
    });
    vi.mocked(accountingClient.fetchArAgingReport).mockResolvedValue({ rows: [], totalOutstanding: 0, glAccountsReceivableBalance: 0, reconciles: true });
    vi.mocked(accountingClient.fetchJournalEntries).mockResolvedValue([makeEntry({ status: 'posted' })]);
    renderPanel();
    expect(await screen.findByText('No manual entries are waiting for review.')).toBeInTheDocument();
  });
});
