import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { bankAccountFixtures, bankReconciliationFixtures } from '@/services/__mocks__/bankingFixtures';
import { ledgerAccountFixtures } from '@/services/__mocks__/ledgerFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { seedChartOfAccounts, getAccountByNumber } from '@/services/chartOfAccountsService';
import { createBankAccount, startReconciliation } from '@/services/bankingService';
import { STARTER_ACCOUNT_NUMBERS } from '@/domain/ledger/starterChartOfAccounts';
import type { ActivityContext } from '@/services/activityService';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `reconciliation-complete-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { POST } = await import('./route');

function postRequest(reconciliationId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/accounting/banking/reconciliations/${reconciliationId}/complete`, { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ reconciliationId }),
  });
}

let reconciliationId = '';
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
  const ctx: ActivityContext = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'x', actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'c1' };
  const reconciliation = await startReconciliation(
    DEFAULT_ORGANIZATION_ID,
    { bankAccountId: account.id, statementEndingDate: '2026-08-31T00:00:00.000Z', statementEndingBalance: 0, idFactory },
    ctx,
    'mock',
  );
  reconciliationId = reconciliation.id;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  bankAccountFixtures.length = lengths.bankAccounts;
  bankReconciliationFixtures.length = lengths.bankReconciliations;
  activityEventFixtures.length = lengths.activityEvents;
});

describe('POST /api/accounting/banking/reconciliations/[reconciliationId]/complete', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest(reconciliationId, { organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('returns 403 for a role without accounting.reconcile', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest(reconciliationId, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });

  it('completes cleanly when balances match', async () => {
    const response = await postRequest(reconciliationId, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.completed).toBe(true);
    expect(body.reconciliation.status).toBe('completed');
  });
});
