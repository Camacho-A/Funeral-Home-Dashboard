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
  return `stmt-lines-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

function getRequest(importId: string, organizationId: string) {
  return GET(new Request(`http://localhost/api/accounting/banking/statement-imports/${importId}/lines?organizationId=${organizationId}`), {
    params: Promise.resolve({ importId }),
  });
}

let importId = '';
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
  const { statementImport } = await importBankStatement(
    DEFAULT_ORGANIZATION_ID,
    { bankAccountId: account.id, fileName: null, statementPeriodStart: null, statementPeriodEnd: null, lines: [{ transactionDate: '2026-08-01T00:00:00.000Z', description: 'X', amount: 1000 }], createdByStaffProfileId: null, idFactory },
    ctx,
    'mock',
  );
  importId = statementImport.id;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  bankAccountFixtures.length = lengths.bankAccounts;
  bankStatementImportFixtures.length = lengths.bankStatementImports;
  bankStatementLineFixtures.length = lengths.bankStatementLines;
  activityEventFixtures.length = lengths.activityEvents;
});

describe('GET /api/accounting/banking/statement-imports/[importId]/lines', () => {
  it('returns 403 for a role without accounting.view', async () => {
    mockSession = { user: mockMultiOrgUser };
    expect((await getRequest(importId, DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns the statement lines', async () => {
    const response = await getRequest(importId, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.lines).toHaveLength(1);
  });
});
