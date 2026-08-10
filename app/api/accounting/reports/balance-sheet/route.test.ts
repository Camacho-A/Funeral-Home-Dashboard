import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from '@/services/__mocks__/ledgerFixtures';
import { seedChartOfAccounts } from '@/services/chartOfAccountsService';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `report-balance-sheet-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

function getRequest(organizationId: string) {
  return GET(new Request(`http://localhost/api/accounting/reports/balance-sheet?organizationId=${organizationId}`));
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

describe('GET /api/accounting/reports/balance-sheet', () => {
  it('returns 403 for a role without accounting.report', async () => {
    mockSession = { user: mockMultiOrgUser };
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns a balanced sheet', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.totalAssets).toBe(body.totalLiabilitiesAndEquity);
  });
});
