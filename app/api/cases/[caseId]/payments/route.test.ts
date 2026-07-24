import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { paymentRecordFixtures } from '@/services/__mocks__/paymentFixtures';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET } = await import('./route');

function requestFor(caseId: string, organizationId: string | null) {
  const url = organizationId
    ? `http://localhost/api/cases/${caseId}/payments?organizationId=${organizationId}`
    : `http://localhost/api/cases/${caseId}/payments`;
  return GET(new Request(url), { params: Promise.resolve({ caseId }) });
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  paymentRecordFixtures.length = 0;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  paymentRecordFixtures.length = 0;
});

describe('GET /api/cases/[caseId]/payments', () => {
  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await requestFor('case-1', DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await requestFor('case-1', SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns 400 when organizationId is missing', async () => {
    expect((await requestFor('case-1', null)).status).toBe(400);
  });

  it('lists payments scoped to the case, most recent first', async () => {
    paymentRecordFixtures.push(
      {
        id: 'p1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', provider: 'clover', providerCheckoutId: 'c1',
        providerPaymentId: null, idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`, checkoutUrl: null, status: 'succeeded', amount: 1000, currency: 'usd', purpose: 'A',
        cardBrand: null, cardLast4: null, receiptReference: null, failureCode: null, failureMessage: null,
        createdAt: '2026-01-01T00:00:00.000Z', paidAt: null, updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'p2', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', provider: 'clover', providerCheckoutId: 'c2',
        providerPaymentId: null, idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-2`, checkoutUrl: null, status: 'pending', amount: 2000, currency: 'usd', purpose: 'B',
        cardBrand: null, cardLast4: null, receiptReference: null, failureCode: null, failureMessage: null,
        createdAt: '2026-01-02T00:00:00.000Z', paidAt: null, updatedAt: '2026-01-02T00:00:00.000Z',
      },
    );

    const response = await requestFor('case-1', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.payments.map((p: { id: string }) => p.id)).toEqual(['p2', 'p1']);
  });

  it('returns an empty list for a case with no payments', async () => {
    const response = await requestFor('no-payments-case', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.payments).toEqual([]);
  });
});
