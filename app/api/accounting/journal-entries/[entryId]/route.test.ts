import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from '@/services/__mocks__/ledgerFixtures';
import { seedChartOfAccounts, getAccountByNumber } from '@/services/chartOfAccountsService';
import { createDraftJournalEntry } from '@/services/generalLedgerService';
import { STARTER_ACCOUNT_NUMBERS } from '@/domain/ledger/starterChartOfAccounts';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `je-detail-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET, PATCH } = await import('./route');

function getRequest(entryId: string, organizationId: string) {
  return GET(new Request(`http://localhost/api/accounting/journal-entries/${entryId}?organizationId=${organizationId}`), { params: Promise.resolve({ entryId }) });
}
function patchRequest(entryId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request(`http://localhost/api/accounting/journal-entries/${entryId}`, { method: 'PATCH', headers, body: JSON.stringify(body) }), {
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
  const entry = await createDraftJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', memo: 'Draft', idFactory }, 'mock');
  entryId = entry.id;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  journalEntryFixtures.length = lengths.journalEntries;
  journalEntryLineFixtures.length = lengths.journalEntryLines;
});

describe('GET /api/accounting/journal-entries/[entryId]', () => {
  it('returns the entry with its lines', async () => {
    const response = await getRequest(entryId, DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entry.id).toBe(entryId);
    expect(body.lines).toEqual([]);
  });

  it('returns 404 for an unknown entry', async () => {
    const response = await getRequest('no-such-entry', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });

  it('returns 403 for a role without accounting.view', async () => {
    mockSession = { user: mockMultiOrgUser };
    expect((await getRequest(entryId, DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });
});

describe('PATCH /api/accounting/journal-entries/[entryId]', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await patchRequest(entryId, { organizationId: DEFAULT_ORGANIZATION_ID, lines: [] }, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('returns 403 for a role without accounting.manage', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await patchRequest(entryId, { organizationId: DEFAULT_ORGANIZATION_ID, lines: [] });
    expect(response.status).toBe(403);
  });

  it('replaces the draft entry lines', async () => {
    const cash = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
    const undeposited = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, 'mock');
    const response = await patchRequest(entryId, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      lines: [
        { accountId: cash!.id, direction: 'debit', amount: 500 },
        { accountId: undeposited!.id, direction: 'credit', amount: 500 },
      ],
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.lines).toHaveLength(2);
  });
});
