import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { ledgerAccountFixtures } from '@/services/__mocks__/ledgerFixtures';
import { caseOrderFixtures } from '@/services/__mocks__/pricingFixtures';
import { seedChartOfAccounts } from '@/services/chartOfAccountsService';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `report-ar-aging-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

function getRequest(organizationId: string) {
  return GET(new Request(`http://localhost/api/accounting/reports/ar-aging?organizationId=${organizationId}`));
}

const NOW = '2026-08-01T00:00:00.000Z';
let lengths: { ledgerAccounts: number; caseOrders: number };
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'mock';
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  lengths = { ledgerAccounts: ledgerAccountFixtures.length, caseOrders: caseOrderFixtures.length };
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  caseOrderFixtures.length = lengths.caseOrders;
});

describe('GET /api/accounting/reports/ar-aging', () => {
  it('returns 403 for a role without accounting.report', async () => {
    mockSession = { user: mockMultiOrgUser };
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns an empty report with no open orders, and it reconciles', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rows).toEqual([]);
    expect(body.reconciles).toBe(true);
  });

  it('includes an open order with a nonzero balanceDue', async () => {
    caseOrderFixtures.push({
      id: 'report-order-1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'report-case-1', status: 'active',
      subtotal: 10_000, discountTotal: 0, taxTotal: 0, total: 10_000, balanceDue: 10_000, version: 1, createdAt: NOW, updatedAt: NOW,
    });
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rows).toHaveLength(1);
    expect(body.totalOutstanding).toBe(10_000);
  });
});
