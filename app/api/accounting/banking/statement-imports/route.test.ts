import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from '@/services/__mocks__/ledgerFixtures';
import { bankAccountFixtures, bankStatementImportFixtures, bankStatementLineFixtures } from '@/services/__mocks__/bankingFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { seedChartOfAccounts, getAccountByNumber } from '@/services/chartOfAccountsService';
import { createBankAccount } from '@/services/bankingService';
import { STARTER_ACCOUNT_NUMBERS } from '@/domain/ledger/starterChartOfAccounts';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `stmt-import-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { POST } = await import('./route');

function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/accounting/banking/statement-imports', { method: 'POST', headers, body: JSON.stringify(body) }));
}

let bankAccountId = '';
let lengths: {
  ledgerAccounts: number;
  journalEntries: number;
  journalEntryLines: number;
  bankAccounts: number;
  bankStatementImports: number;
  bankStatementLines: number;
  activityEvents: number;
};
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'mock';
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  lengths = {
    ledgerAccounts: ledgerAccountFixtures.length,
    journalEntries: journalEntryFixtures.length,
    journalEntryLines: journalEntryLineFixtures.length,
    bankAccounts: bankAccountFixtures.length,
    bankStatementImports: bankStatementImportFixtures.length,
    bankStatementLines: bankStatementLineFixtures.length,
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
  journalEntryFixtures.length = lengths.journalEntries;
  journalEntryLineFixtures.length = lengths.journalEntryLines;
  bankAccountFixtures.length = lengths.bankAccounts;
  bankStatementImportFixtures.length = lengths.bankStatementImports;
  bankStatementLineFixtures.length = lengths.bankStatementLines;
  activityEventFixtures.length = lengths.activityEvents;
});

describe('POST /api/accounting/banking/statement-imports', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('returns 403 for a role without accounting.reconcile', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest({
      organizationId: DEFAULT_ORGANIZATION_ID,
      bankAccountId,
      lines: [{ transactionDate: '2026-08-01T00:00:00.000Z', description: 'Deposit', amount: 5000 }],
    });
    expect(response.status).toBe(403);
  });

  it('imports the statement lines and attempts auto-match', async () => {
    const response = await postRequest({
      organizationId: DEFAULT_ORGANIZATION_ID,
      bankAccountId,
      fileName: 'statement.csv',
      lines: [{ transactionDate: '2026-08-01T00:00:00.000Z', description: 'Deposit', amount: 5000 }],
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.lines).toHaveLength(1);
    expect(body.autoMatchedCount).toBe(0);
  });
});
