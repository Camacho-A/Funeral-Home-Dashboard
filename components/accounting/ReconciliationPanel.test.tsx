import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReconciliationPanel } from './ReconciliationPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import * as accountingClient from '@/lib/accountingClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { BankAccount } from '@/types/bankAccount';
import type { BankReconciliation } from '@/types/bankReconciliation';

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

vi.mock('@/lib/accountingClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/accountingClient')>('@/lib/accountingClient');
  return {
    ...actual,
    fetchBankAccounts: vi.fn(),
    fetchReconciliations: vi.fn(),
    fetchStatementImportLines: vi.fn(),
    importBankStatementClient: vi.fn(),
    manuallyMatchStatementLineClient: vi.fn(),
    excludeStatementLineClient: vi.fn(),
    startBankReconciliation: vi.fn(),
    completeBankReconciliation: vi.fn(),
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

function makeReconciliation(overrides: Partial<BankReconciliation> = {}): BankReconciliation {
  return {
    id: 'reconciliation-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    bankAccountId: 'bank-account-1',
    statementEndingDate: '2026-07-31T00:00:00.000Z',
    statementEndingBalance: 50000,
    bookBalanceAtStart: 0,
    status: 'in_progress',
    bankStatementImportId: null,
    completedAt: null,
    completedByStaffProfileId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <ReconciliationPanel />
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

describe('ReconciliationPanel — permission gating', () => {
  it('shows nothing to a role without accounting.view', async () => {
    mockPermissions([]);
    vi.mocked(accountingClient.fetchBankAccounts).mockResolvedValue([makeBankAccount()]);
    renderPanel();
    expect(await screen.findByText("You don't have access to reconciliation for this organization.")).toBeInTheDocument();
  });

  it('hides reconciliation actions for a role with view but not reconcile', async () => {
    mockPermissions(['accounting.view']);
    vi.mocked(accountingClient.fetchBankAccounts).mockResolvedValue([makeBankAccount()]);
    vi.mocked(accountingClient.fetchReconciliations).mockResolvedValue([makeReconciliation()]);
    renderPanel();

    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'bank-account-1' } });
    await screen.findByText('Through 2026-07-31');
    expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start a new statement import' })).not.toBeInTheDocument();
  });

  it('completes an in-progress reconciliation for a role with accounting.reconcile', async () => {
    mockPermissions(['accounting.view', 'accounting.reconcile']);
    vi.mocked(accountingClient.fetchBankAccounts).mockResolvedValue([makeBankAccount()]);
    vi.mocked(accountingClient.fetchReconciliations).mockResolvedValue([makeReconciliation()]);
    vi.mocked(accountingClient.completeBankReconciliation).mockResolvedValue({
      reconciliation: makeReconciliation({ status: 'completed' }),
      variance: 0,
      completed: true,
    });
    renderPanel();

    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'bank-account-1' } });
    await screen.findByText('Through 2026-07-31');

    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(accountingClient.completeBankReconciliation).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, 'reconciliation-1'));
  });
});
