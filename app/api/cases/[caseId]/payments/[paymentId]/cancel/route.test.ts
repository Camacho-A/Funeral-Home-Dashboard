import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { paymentRecordFixtures } from '@/services/__mocks__/paymentFixtures';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import type { PaymentRecord } from '@/types/payment';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { POST } = await import('./route');

function postCancel(caseId: string, paymentId: string, organizationId: unknown) {
  return POST(
    new Request(`http://localhost/x`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId }),
    }),
    { params: Promise.resolve({ caseId, paymentId }) },
  );
}

const SEED: PaymentRecord = {
  id: 'payment-1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', provider: 'clover',
  providerCheckoutId: 'checkout-1', providerPaymentId: null, idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`, checkoutUrl: 'https://clover.test/x',
  status: 'pending', amount: 1000, currency: 'usd', purpose: 'Fee',
  cardBrand: null, cardLast4: null, receiptReference: null, failureCode: null, failureMessage: null,
  createdAt: '2026-01-01T00:00:00.000Z', paidAt: null, updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  paymentRecordFixtures.length = 0;
  paymentRecordFixtures.push({ ...SEED });
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  paymentRecordFixtures.length = 0;
});

describe('POST .../payments/[paymentId]/cancel', () => {
  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await postCancel('case-1', 'payment-1', DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await postCancel('case-1', 'payment-1', SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('marks a pending payment cancelled', async () => {
    const response = await postCancel('case-1', 'payment-1', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.payment.status).toBe('cancelled');
  });

  it('returns 404 for a mismatched case/payment pair', async () => {
    const response = await postCancel('some-other-case', 'payment-1', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });

  it('is a no-op (never downgrades) for an already-succeeded payment', async () => {
    paymentRecordFixtures[0] = { ...paymentRecordFixtures[0], status: 'succeeded' };
    const response = await postCancel('case-1', 'payment-1', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.payment.status).toBe('succeeded');
  });
});
