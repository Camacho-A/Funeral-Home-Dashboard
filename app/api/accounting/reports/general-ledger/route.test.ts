import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from '@/services/__mocks__/ledgerFixtures';
import { seedChartOfAccounts, getAccountByNumber } from '@/services/chartOfAccountsService';
import { STARTER_ACCOUNT_NUMBERS } from '@/domain/ledger/starterChartOfAccounts';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `report-gl-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

function getRequest(organizationId: string, accountId: string) {
  return GET(new Request(`http://localhost/api/accounting/reports/general-ledger?organizationId=${organizationId}&accountId=${accountId}`));
}

let lengths: { ledgerAccounts: number; journalEntries: number; journalEntryLines: number };
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'mock';
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  lengths = { ledgerAccounts: ledgerAccountFixtures.length, journalEntries: journalEntryFixtures.length, journalEntryLines: journalEntryLineFixtures.length };
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  journalEntryFixtures.length = lengths.journalEntries;
  journalEntryLineFixtures.length = lengths.journalEntryLines;
});

describe('GET /api/accounting/reports/general-ledger', () => {
  it('returns 403 for a role without accounting.report', async () => {
    mockSession = { user: mockMultiOrgUser };
    const cash = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
    expect((await getRequest(DEFAULT_ORGANIZATION_ID, cash!.id)).status).toBe(403);
  });

  it('returns 404 for an unknown account', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID, 'no-such-account');
    expect(response.status).toBe(404);
  });

  it('returns the account detail with an ending balance', async () => {
    const cash = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
    const response = await getRequest(DEFAULT_ORGANIZATION_ID, cash!.id);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.account.accountNumber).toBe(STARTER_ACCOUNT_NUMBERS.CASH_OPERATING);
    expect(body.endingBalance).toBe(0);
  });
});
