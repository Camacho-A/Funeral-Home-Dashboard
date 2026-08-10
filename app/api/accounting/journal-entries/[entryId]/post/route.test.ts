import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from '@/services/__mocks__/ledgerFixtures';
import { seedChartOfAccounts, getAccountByNumber } from '@/services/chartOfAccountsService';
import { createDraftJournalEntry, updateDraftJournalEntryLines } from '@/services/generalLedgerService';
import { STARTER_ACCOUNT_NUMBERS } from '@/domain/ledger/starterChartOfAccounts';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `je-post-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { POST } = await import('./route');

function postRequest(entryId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/accounting/journal-entries/${entryId}/post`, { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ entryId }),
  });
}

let entryId = '';
let lengths: { ledgerAccounts: number; journalEntries: number; journalEntryLines: number };
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'mock';
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  lengths = { ledgerAccounts: ledgerAccountFixtures.length, journalEntries: journalEntryFixtures.length, journalEntryLines: journalEntryLineFixtures.length };
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
  const cash = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
  const undeposited = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, 'mock');
  const entry = await createDraftJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', memo: 'Draft', idFactory }, 'mock');
  await updateDraftJournalEntryLines(
    DEFAULT_ORGANIZATION_ID,
    entry.id,
    [
      { accountId: cash!.id, direction: 'debit', amount: 100 },
      { accountId: undeposited!.id, direction: 'credit', amount: 100 },
    ],
    'mock',
  );
  entryId = entry.id;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  journalEntryFixtures.length = lengths.journalEntries;
  journalEntryLineFixtures.length = lengths.journalEntryLines;
});

describe('POST /api/accounting/journal-entries/[entryId]/post', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest(entryId, { organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('returns 403 for a role without accounting.post', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest(entryId, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });

  it('posts the balanced draft entry', async () => {
    const response = await postRequest(entryId, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entry.status).toBe('posted');
  });
});
