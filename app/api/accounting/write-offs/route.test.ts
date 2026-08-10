import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures, caseWriteOffFixtures } from '@/services/__mocks__/ledgerFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { seedChartOfAccounts } from '@/services/chartOfAccountsService';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `write-off-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { POST } = await import('./route');

function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/accounting/write-offs', { method: 'POST', headers, body: JSON.stringify(body) }));
}

let lengths: { ledgerAccounts: number; journalEntries: number; journalEntryLines: number; caseWriteOffs: number; activityEvents: number };
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'mock';
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  lengths = {
    ledgerAccounts: ledgerAccountFixtures.length,
    journalEntries: journalEntryFixtures.length,
    journalEntryLines: journalEntryLineFixtures.length,
    caseWriteOffs: caseWriteOffFixtures.length,
    activityEvents: activityEventFixtures.length,
  };
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  journalEntryFixtures.length = lengths.journalEntries;
  journalEntryLineFixtures.length = lengths.journalEntryLines;
  caseWriteOffFixtures.length = lengths.caseWriteOffs;
  activityEventFixtures.length = lengths.activityEvents;
});

describe('POST /api/accounting/write-offs', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('returns 400 for a non-positive amountCents', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', amountCents: 0, reason: 'X' });
    expect(response.status).toBe(400);
  });

  it('returns 403 for a role without accounting.manage', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', amountCents: 1000, reason: 'X' });
    expect(response.status).toBe(403);
  });

  it('posts the write-off', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', amountCents: 5000, reason: 'Uncollectible' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.writeOff.amount).toBe(5000);
  });
});
