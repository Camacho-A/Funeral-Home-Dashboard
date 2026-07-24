import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { paymentRecordFixtures } from '@/services/__mocks__/paymentFixtures';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import type { PaymentRecord } from '@/types/payment';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { POST } = await import('./route');

function postSimulate(caseId: string, paymentId: string, organizationId: unknown) {
  return POST(
    new Request(`http://localhost/x`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId }),
    }),
    { params: Promise.resolve({ caseId, paymentId }) },
  );
}

let knownCaseId: string;
let caseFixtureIndex = -1;
let originalCaseFixture: (typeof caseFixtures)[number];

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  paymentRecordFixtures.length = 0;

  caseFixtureIndex = caseFixtures.findIndex((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted);
  originalCaseFixture = caseFixtures[caseFixtureIndex];
  knownCaseId = originalCaseFixture.id;

  const seed: PaymentRecord = {
    id: 'payment-1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: knownCaseId, provider: 'clover',
    providerCheckoutId: 'mock-checkout-payment-1', providerPaymentId: null, idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`, checkoutUrl: 'https://beacon.test/mock',
    status: 'pending', amount: 1000, currency: 'usd', purpose: 'Fee',
    cardBrand: null, cardLast4: null, receiptReference: null, failureCode: null, failureMessage: null,
    createdAt: '2026-01-01T00:00:00.000Z', paidAt: null, updatedAt: '2026-01-01T00:00:00.000Z',
  };
  paymentRecordFixtures.push(seed);
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  paymentRecordFixtures.length = 0;
  if (caseFixtureIndex !== -1) caseFixtures[caseFixtureIndex] = originalCaseFixture;
});

describe('POST .../payments/[paymentId]/simulate', () => {
  it('returns 400 in wix mode — simulated outcomes are mock-only', async () => {
    process.env.DATA_ADAPTER = 'wix';
    const response = await postSimulate(knownCaseId, 'payment-1', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await postSimulate(knownCaseId, 'payment-1', DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await postSimulate(knownCaseId, 'payment-1', SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('marks the payment succeeded with safe synthetic card metadata, and marks the case paid', async () => {
    const response = await postSimulate(knownCaseId, 'payment-1', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();

    expect(body.payment.status).toBe('succeeded');
    expect(body.payment.cardLast4).toBe('1111');

    const updatedCase = caseFixtures.find((c) => c.id === knownCaseId)!;
    expect(updatedCase.paymentStatus).toBe('paid_in_full');
  });

  it('is a no-op for an already-terminal payment', async () => {
    paymentRecordFixtures[0] = { ...paymentRecordFixtures[0], status: 'cancelled' };
    const response = await postSimulate(knownCaseId, 'payment-1', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(body.payment.status).toBe('cancelled');
  });
});
