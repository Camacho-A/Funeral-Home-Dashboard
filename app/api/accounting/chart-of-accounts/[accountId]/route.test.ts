import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { ledgerAccountFixtures } from '@/services/__mocks__/ledgerFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { seedChartOfAccounts, createAccount } from '@/services/chartOfAccountsService';
import type { ActivityContext } from '@/services/activityService';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `coa-id-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { PATCH } = await import('./route');

function patchRequest(accountId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return PATCH(new Request(`http://localhost/api/accounting/chart-of-accounts/${accountId}`, { method: 'PATCH', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ accountId }),
  });
}

let accountId = '';
let lengths: { ledgerAccounts: number; activityEvents: number };
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'mock';
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  lengths = { ledgerAccounts: ledgerAccountFixtures.length, activityEvents: activityEventFixtures.length };
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
  const ctx: ActivityContext = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'x', actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'c1' };
  const account = await createAccount(DEFAULT_ORGANIZATION_ID, { accountNumber: '9500', name: 'Custom', accountType: 'asset', normalBalance: 'debit', idFactory }, ctx, 'mock');
  accountId = account.id;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  activityEventFixtures.length = lengths.activityEvents;
});

describe('PATCH /api/accounting/chart-of-accounts/[accountId]', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await patchRequest(accountId, { organizationId: DEFAULT_ORGANIZATION_ID, name: 'X' }, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('returns 403 for a role without accounting.manage', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await patchRequest(accountId, { organizationId: DEFAULT_ORGANIZATION_ID, name: 'X' });
    expect(response.status).toBe(403);
  });

  it('updates the account name', async () => {
    const response = await patchRequest(accountId, { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Renamed' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.account.name).toBe('Renamed');
  });

  it('deactivates the account when deactivate is true', async () => {
    const response = await patchRequest(accountId, { organizationId: DEFAULT_ORGANIZATION_ID, deactivate: true });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.account.isActive).toBe(false);
  });
});
