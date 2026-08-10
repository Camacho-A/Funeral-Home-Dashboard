import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from '@/services/__mocks__/ledgerFixtures';
import { seedChartOfAccounts } from '@/services/chartOfAccountsService';
import { createDraftJournalEntry } from '@/services/generalLedgerService';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `je-void-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { POST } = await import('./route');

function postRequest(entryId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/accounting/journal-entries/${entryId}/void`, { method: 'POST', headers, body: JSON.stringify(body) }), {
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

describe('POST /api/accounting/journal-entries/[entryId]/void', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest(entryId, { organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('returns 403 for a role without accounting.post', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest(entryId, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });

  it('voids the draft entry', async () => {
    const response = await postRequest(entryId, { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entry.status).toBe('void');
  });
});
