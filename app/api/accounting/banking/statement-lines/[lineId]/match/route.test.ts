import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { bankAccountFixtures, bankStatementImportFixtures, bankStatementLineFixtures } from '@/services/__mocks__/bankingFixtures';
import { ledgerAccountFixtures } from '@/services/__mocks__/ledgerFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { seedChartOfAccounts, getAccountByNumber } from '@/services/chartOfAccountsService';
import { createBankAccount, importBankStatement } from '@/services/bankingService';
import { STARTER_ACCOUNT_NUMBERS } from '@/domain/ledger/starterChartOfAccounts';
import type { ActivityContext } from '@/services/activityService';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `stmt-match-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { POST } = await import('./route');

function postRequest(lineId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/accounting/banking/statement-lines/${lineId}/match`, { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ lineId }),
  });
}

let lineId = '';
let lengths: { ledgerAccounts: number; bankAccounts: number; bankStatementImports: number; bankStatementLines: number; activityEvents: number };
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'mock';
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  lengths = {
    ledgerAccounts: ledgerAccountFixtures.length,
    bankAccounts: bankAccountFixtures.length,
    bankStatementImports: bankStatementImportFixtures.length,
    bankStatementLines: bankStatementLineFixtures.length,
    activityEvents: activityEventFixtures.length,
  };
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
  const cash = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
  const account = await createBankAccount(DEFAULT_ORGANIZATION_ID, { name: 'Operating', ledgerAccountId: cash!.id, idFactory }, 'mock');
  const ctx: ActivityContext = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'x', actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'c1' };
  const { lines } = await importBankStatement(
    DEFAULT_ORGANIZATION_ID,
    { bankAccountId: account.id, fileName: null, statementPeriodStart: null, statementPeriodEnd: null, lines: [{ transactionDate: '2026-08-01T00:00:00.000Z', description: 'X', amount: 1000 }], createdByStaffProfileId: null, idFactory },
    ctx,
    'mock',
  );
  lineId = lines[0].id;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  bankAccountFixtures.length = lengths.bankAccounts;
  bankStatementImportFixtures.length = lengths.bankStatementImports;
  bankStatementLineFixtures.length = lengths.bankStatementLines;
  activityEventFixtures.length = lengths.activityEvents;
});

describe('POST /api/accounting/banking/statement-lines/[lineId]/match', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest(lineId, { organizationId: DEFAULT_ORGANIZATION_ID, journalEntryId: 'je-1' }, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('returns 403 for a role without accounting.reconcile', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest(lineId, { organizationId: DEFAULT_ORGANIZATION_ID, journalEntryId: 'je-1' });
    expect(response.status).toBe(403);
  });

  it('manually matches the line', async () => {
    const response = await postRequest(lineId, { organizationId: DEFAULT_ORGANIZATION_ID, journalEntryId: 'je-manual-1' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.line.matchStatus).toBe('manually_matched');
    expect(body.line.matchedJournalEntryId).toBe('je-manual-1');
  });
});
