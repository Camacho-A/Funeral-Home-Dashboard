import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { ledgerAccountFixtures } from '@/services/__mocks__/ledgerFixtures';
import { bankAccountFixtures } from '@/services/__mocks__/bankingFixtures';
import { seedChartOfAccounts, getAccountByNumber } from '@/services/chartOfAccountsService';
import { STARTER_ACCOUNT_NUMBERS } from '@/domain/ledger/starterChartOfAccounts';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `bank-account-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET, POST } = await import('./route');

function getRequest(organizationId: string) {
  return GET(new Request(`http://localhost/api/accounting/banking/accounts?organizationId=${organizationId}`));
}
function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/accounting/banking/accounts', { method: 'POST', headers, body: JSON.stringify(body) }));
}

let lengths: { ledgerAccounts: number; bankAccounts: number };
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'mock';
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  lengths = { ledgerAccounts: ledgerAccountFixtures.length, bankAccounts: bankAccountFixtures.length };
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  bankAccountFixtures.length = lengths.bankAccounts;
});

describe('GET /api/accounting/banking/accounts', () => {
  it('returns 403 for a role without accounting.view', async () => {
    mockSession = { user: mockMultiOrgUser };
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns an empty list when no bank accounts exist', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accounts).toEqual([]);
  });
});

describe('POST /api/accounting/banking/accounts', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('returns 403 for a role without accounting.manage', async () => {
    mockSession = { user: mockMultiOrgUser };
    const cash = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, name: 'Operating', ledgerAccountId: cash!.id });
    expect(response.status).toBe(403);
  });

  it('creates a bank account linked to an asset ledger account', async () => {
    const cash = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, name: 'Operating', ledgerAccountId: cash!.id });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.account.name).toBe('Operating');
  });
});
