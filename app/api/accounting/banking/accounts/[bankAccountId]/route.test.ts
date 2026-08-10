import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { ledgerAccountFixtures } from '@/services/__mocks__/ledgerFixtures';
import { bankAccountFixtures } from '@/services/__mocks__/bankingFixtures';
import { seedChartOfAccounts, getAccountByNumber } from '@/services/chartOfAccountsService';
import { createBankAccount } from '@/services/bankingService';
import { STARTER_ACCOUNT_NUMBERS } from '@/domain/ledger/starterChartOfAccounts';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `bank-account-id-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { PATCH } = await import('./route');

function patchRequest(bankAccountId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request(`http://localhost/api/accounting/banking/accounts/${bankAccountId}`, { method: 'PATCH', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ bankAccountId }),
  });
}

let bankAccountId = '';
let lengths: { ledgerAccounts: number; bankAccounts: number };
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'mock';
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  lengths = { ledgerAccounts: ledgerAccountFixtures.length, bankAccounts: bankAccountFixtures.length };
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
  const cash = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
  const account = await createBankAccount(DEFAULT_ORGANIZATION_ID, { name: 'Operating', ledgerAccountId: cash!.id, idFactory }, 'mock');
  bankAccountId = account.id;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  bankAccountFixtures.length = lengths.bankAccounts;
});

describe('PATCH /api/accounting/banking/accounts/[bankAccountId]', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await patchRequest(bankAccountId, { organizationId: DEFAULT_ORGANIZATION_ID, deactivate: true }, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('returns 403 for a role without accounting.manage', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await patchRequest(bankAccountId, { organizationId: DEFAULT_ORGANIZATION_ID, deactivate: true });
    expect(response.status).toBe(403);
  });

  it('deactivates the bank account', async () => {
    const response = await patchRequest(bankAccountId, { organizationId: DEFAULT_ORGANIZATION_ID, deactivate: true });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.account.isActive).toBe(false);
  });
});
