import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JournalEntriesPanel } from './JournalEntriesPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import * as accountingClient from '@/lib/accountingClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { JournalEntry } from '@/types/journalEntry';
import type { LedgerAccount } from '@/types/ledgerAccount';

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

vi.mock('@/lib/accountingClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/accountingClient')>('@/lib/accountingClient');
  return {
    ...actual,
    fetchJournalEntries: vi.fn(),
    fetchChartOfAccounts: vi.fn(),
    createManualJournalEntry: vi.fn(),
    postJournalEntry: vi.fn(),
    voidJournalEntry: vi.fn(),
    reverseJournalEntry: vi.fn(),
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
    memo: 'Test entry',
    reversesEntryId: null,
    postedAt: null,
    postedByStaffProfileId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

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
        <JournalEntriesPanel />
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

describe('JournalEntriesPanel — permission gating', () => {
  it('shows nothing to a role without accounting.view', async () => {
    mockPermissions([]);
    vi.mocked(accountingClient.fetchJournalEntries).mockResolvedValue([makeEntry()]);
    vi.mocked(accountingClient.fetchChartOfAccounts).mockResolvedValue([makeAccount()]);
    renderPanel();
    expect(await screen.findByText("You don't have access to journal entries for this organization.")).toBeInTheDocument();
  });

  it('hides Post/Void for a role with view but not post', async () => {
    mockPermissions(['accounting.view']);
    vi.mocked(accountingClient.fetchJournalEntries).mockResolvedValue([makeEntry()]);
    vi.mocked(accountingClient.fetchChartOfAccounts).mockResolvedValue([makeAccount()]);
    renderPanel();
    await screen.findByText('Test entry');
    expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument();
  });

  it('posts a draft entry for a role with accounting.post', async () => {
    mockPermissions(['accounting.view', 'accounting.post']);
    vi.mocked(accountingClient.fetchJournalEntries).mockResolvedValue([makeEntry()]);
    vi.mocked(accountingClient.fetchChartOfAccounts).mockResolvedValue([makeAccount()]);
    vi.mocked(accountingClient.postJournalEntry).mockResolvedValue(makeEntry({ status: 'posted' }));
    renderPanel();
    await screen.findByText('Test entry');

    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(accountingClient.postJournalEntry).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, 'entry-1'));
  });
});
