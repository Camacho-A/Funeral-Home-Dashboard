import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { bankAccountFixtures, bankReconciliationFixtures } from '@/services/__mocks__/bankingFixtures';
import { ledgerAccountFixtures } from '@/services/__mocks__/ledgerFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { seedChartOfAccounts, getAccountByNumber } from '@/services/chartOfAccountsService';
import { createBankAccount } from '@/services/bankingService';
import { STARTER_ACCOUNT_NUMBERS } from '@/domain/ledger/starterChartOfAccounts';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `reconciliation-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET, POST } = await import('./route');

function getRequest(organizationId: string, bankAccountId: string) {
  return GET(new Request(`http://localhost/api/accounting/banking/reconciliations?organizationId=${organizationId}&bankAccountId=${bankAccountId}`));
}
function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/accounting/banking/reconciliations', { method: 'POST', headers, body: JSON.stringify(body) }));
}

let bankAccountId = '';
let lengths: { ledgerAccounts: number; bankAccounts: number; bankReconciliations: number; activityEvents: number };
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'mock';
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  lengths = {
    ledgerAccounts: ledgerAccountFixtures.length,
    bankAccounts: bankAccountFixtures.length,
    bankReconciliations: bankReconciliationFixtures.length,
    activityEvents: activityEventFixtures.length,
  };
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
  const cash = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
  const account = await createBankAccount(DEFAULT_ORGANIZATION_ID, { name: 'Operating', ledgerAccountId: cash!.id, idFactory }, 'mock');
  bankAccountId = account.id;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  bankAccountFixtures.length = lengths.bankAccounts;
  bankReconciliationFixtures.length = lengths.bankReconciliations;
  activityEventFixtures.length = lengths.activityEvents;
});

describe('GET /api/accounting/banking/reconciliations', () => {
  it('returns 403 for a role without accounting.view', async () => {
    mockSession = { user: mockMultiOrgUser };
    expect((await getRequest(DEFAULT_ORGANIZATION_ID, bankAccountId)).status).toBe(403);
  });

  it('returns an empty history for a new bank account', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID, bankAccountId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reconciliations).toEqual([]);
  });
});

describe('POST /api/accounting/banking/reconciliations', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('returns 403 for a role without accounting.reconcile', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, bankAccountId, statementEndingDate: '2026-08-31T00:00:00.000Z', statementEndingBalance: 0 });
    expect(response.status).toBe(403);
  });

  it('starts a new reconciliation with bookBalanceAtStart 0 for a first-time account', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, bankAccountId, statementEndingDate: '2026-08-31T00:00:00.000Z', statementEndingBalance: 0 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reconciliation.bookBalanceAtStart).toBe(0);
    expect(body.reconciliation.status).toBe('in_progress');
  });
});
