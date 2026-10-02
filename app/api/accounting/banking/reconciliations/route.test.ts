import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser, mockOrganizationFixtures } from '@/services/__mocks__/authFixtures';
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

// Manors branding/visibility follow-up (2026-10). Reconciliation is now
// additionally gated on the `reconciliation` module (default: disabled,
// matching Manors' own real state) — every test below predates that gate
// and asserts on the underlying reconcile *feature*, not the new
// visibility behavior, so the module is enabled here for the duration of
// this file only (restored after), letting the existing tests keep
// proving the feature itself still works end-to-end for an organization
// that HAS opted in. The new "module disabled" 403 behavior gets its own,
// separate test below instead of silently changing what every other test
// here means.
const manorsOrg = mockOrganizationFixtures.find((o) => o.id === DEFAULT_ORGANIZATION_ID)!;

let bankAccountId = '';
let lengths: { ledgerAccounts: number; bankAccounts: number; bankReconciliations: number; activityEvents: number };
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'mock';
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  manorsOrg.enabledModules = ['reconciliation'];
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
  manorsOrg.enabledModules = undefined;
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

describe('Reconciliation module visibility (Manors branding/visibility follow-up, 2026-10)', () => {
  it('returns 403 for GET when the organization has not enabled the reconciliation module, even for an administrator', async () => {
    manorsOrg.enabledModules = undefined;
    expect((await getRequest(DEFAULT_ORGANIZATION_ID, bankAccountId)).status).toBe(403);
  });

  it('returns 403 for POST when the organization has not enabled the reconciliation module, even for an administrator', async () => {
    manorsOrg.enabledModules = undefined;
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, bankAccountId, statementEndingDate: '2026-08-31T00:00:00.000Z', statementEndingBalance: 0 });
    expect(response.status).toBe(403);
  });
});
