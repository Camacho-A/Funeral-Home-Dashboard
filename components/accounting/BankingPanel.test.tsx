import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BankingPanel } from './BankingPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import * as accountingClient from '@/lib/accountingClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { BankAccount } from '@/types/bankAccount';
import type { BankDeposit } from '@/types/bankDeposit';
import type { LedgerAccount } from '@/types/ledgerAccount';

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

vi.mock('@/lib/accountingClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/accountingClient')>('@/lib/accountingClient');
  return {
    ...actual,
    fetchChartOfAccounts: vi.fn(),
    fetchBankAccounts: vi.fn(),
    fetchBankDeposits: vi.fn(),
    createBankAccountClient: vi.fn(),
    deactivateBankAccountClient: vi.fn(),
  };
});

function makeBankAccount(overrides: Partial<BankAccount> = {}): BankAccount {
  return {
    id: 'bank-account-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    name: 'Operating Account',
    ledgerAccountId: 'account-1',
    accountNumberLast4: null,
    bankName: 'First National',
    isActive: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeDeposit(overrides: Partial<BankDeposit> = {}): BankDeposit {
  return {
    id: 'deposit-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    bankAccountId: 'bank-account-1',
    depositDate: '2026-08-01T00:00:00.000Z',
    totalAmount: 5000,
    includedPaymentRecordIds: ['payment-1'],
    journalEntryId: 'entry-1',
    memo: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    createdByStaffProfileId: null,
    ...overrides,
  };
}

function makeLedgerAccount(overrides: Partial<LedgerAccount> = {}): LedgerAccount {
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
        <BankingPanel />
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

describe('BankingPanel — permission gating', () => {
  it('shows nothing to a role without accounting.view', async () => {
    mockPermissions([]);
    vi.mocked(accountingClient.fetchBankAccounts).mockResolvedValue([makeBankAccount()]);
    vi.mocked(accountingClient.fetchChartOfAccounts).mockResolvedValue([makeLedgerAccount()]);
    vi.mocked(accountingClient.fetchBankDeposits).mockResolvedValue([makeDeposit()]);
    renderPanel();
    expect(await screen.findByText("You don't have access to banking for this organization.")).toBeInTheDocument();
  });

  it('hides "+ New Bank Account" and Deactivate for a role with view but not manage', async () => {
    mockPermissions(['accounting.view']);
    vi.mocked(accountingClient.fetchBankAccounts).mockResolvedValue([makeBankAccount()]);
    vi.mocked(accountingClient.fetchChartOfAccounts).mockResolvedValue([makeLedgerAccount()]);
    vi.mocked(accountingClient.fetchBankDeposits).mockResolvedValue([makeDeposit()]);
    renderPanel();
    await screen.findByText('Operating Account');
    expect(screen.queryByRole('button', { name: '+ New Bank Account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
  });

  it('creates a bank account for a role with accounting.manage', async () => {
    mockPermissions(['accounting.view', 'accounting.manage']);
    vi.mocked(accountingClient.fetchBankAccounts).mockResolvedValue([]);
    vi.mocked(accountingClient.fetchChartOfAccounts).mockResolvedValue([makeLedgerAccount()]);
    vi.mocked(accountingClient.fetchBankDeposits).mockResolvedValue([]);
    vi.mocked(accountingClient.createBankAccountClient).mockResolvedValue(makeBankAccount({ id: 'bank-account-2', name: 'Reserve Account' }));
    renderPanel();
    await screen.findByText('No bank accounts have been added yet.');

    fireEvent.click(screen.getByRole('button', { name: '+ New Bank Account' }));
    fireEvent.change(screen.getByPlaceholderText('Name (e.g. Operating)'), { target: { value: 'Reserve Account' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'account-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(accountingClient.createBankAccountClient).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Reserve Account', ledgerAccountId: 'account-1' }),
      ),
    );
  });
});
