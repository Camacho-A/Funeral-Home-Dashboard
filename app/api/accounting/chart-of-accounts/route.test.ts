import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { ledgerAccountFixtures } from '@/services/__mocks__/ledgerFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { seedChartOfAccounts } from '@/services/chartOfAccountsService';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `coa-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET, POST } = await import('./route');

function getRequest(organizationId: string) {
  return GET(new Request(`http://localhost/api/accounting/chart-of-accounts?organizationId=${organizationId}`));
}
function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/accounting/chart-of-accounts', { method: 'POST', headers, body: JSON.stringify(body) }));
}

let lengths: { ledgerAccounts: number; activityEvents: number };
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'mock';
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  lengths = { ledgerAccounts: ledgerAccountFixtures.length, activityEvents: activityEventFixtures.length };
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  activityEventFixtures.length = lengths.activityEvents;
});

describe('GET /api/accounting/chart-of-accounts', () => {
  it('returns 400 without organizationId', async () => {
    const response = await GET(new Request('http://localhost/api/accounting/chart-of-accounts'));
    expect(response.status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns the seeded starter chart for an administrator', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accounts.length).toBeGreaterThan(0);
  });

  it('returns 403 for a role without accounting.view', async () => {
    mockSession = { user: mockMultiOrgUser };
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });
});

describe('POST /api/accounting/chart-of-accounts', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('returns 400 for a missing accountNumber', async () => {
    const response = await postRequest({ organizationId: DEFAULT_ORGANIZATION_ID, name: 'X', accountType: 'asset', normalBalance: 'debit' });
    expect(response.status).toBe(400);
  });

  it('returns 403 for a role without accounting.manage', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest({
      organizationId: DEFAULT_ORGANIZATION_ID,
      accountNumber: '9999',
      name: 'Custom',
      accountType: 'asset',
      normalBalance: 'debit',
    });
    expect(response.status).toBe(403);
  });

  it('creates a custom account for an administrator', async () => {
    const response = await postRequest({
      organizationId: DEFAULT_ORGANIZATION_ID,
      accountNumber: '9999',
      name: 'Custom Account',
      accountType: 'asset',
      normalBalance: 'debit',
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.account.accountNumber).toBe('9999');
  });
});
