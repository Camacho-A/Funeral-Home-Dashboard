import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { paymentRecordFixtures } from '@/services/__mocks__/paymentFixtures';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import type { PaymentRecord } from '@/types/payment';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

let mockGetPaymentStatus = vi.fn();
vi.mock('@/lib/clover/cloverProvider', () => ({
  cloverProvider: {
    getPaymentStatus: (...args: unknown[]) => mockGetPaymentStatus(...args),
  },
}));

let mockQueryWixDataItems = vi.fn();
let mockUpdateWixDataItem = vi.fn();
vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  return {
    queryWixDataItems: (...args: unknown[]) => {
      getWixServerConfig();
      return mockQueryWixDataItems(...args);
    },
    updateWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockUpdateWixDataItem(...args);
    },
  };
});

const { GET } = await import('./route');

function requestFor(caseId: string, paymentId: string, organizationId: string | null) {
  const url = organizationId
    ? `http://localhost/api/cases/${caseId}/payments/${paymentId}?organizationId=${organizationId}`
    : `http://localhost/api/cases/${caseId}/payments/${paymentId}`;
  return GET(new Request(url), { params: Promise.resolve({ caseId, paymentId }) });
}

const SEED: PaymentRecord = {
  id: 'payment-1',
  organizationId: DEFAULT_ORGANIZATION_ID,
  caseId: 'case-1',
  provider: 'clover',
  providerCheckoutId: 'checkout-1',
  providerPaymentId: null,
  idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`,
  checkoutUrl: 'https://apisandbox.dev.clover.com/checkout-1',
  status: 'pending',
  amount: 1000,
  currency: 'usd',
  purpose: 'Fee',
  cardBrand: null,
  cardLast4: null,
  receiptReference: null,
  failureCode: null,
  failureMessage: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  paidAt: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  mockGetPaymentStatus = vi.fn().mockResolvedValue(null);
  paymentRecordFixtures.length = 0;
  paymentRecordFixtures.push({ ...SEED });
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  paymentRecordFixtures.length = 0;
});

describe('GET .../payments/[paymentId] — authorization', () => {
  it('returns 401 when there is no session', async () => {
    mockSession = null;
    const response = await requestFor('case-1', 'payment-1', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(401);
  });

  it('returns 403 for a forged organizationId', async () => {
    const response = await requestFor('case-1', 'payment-1', SECOND_MOCK_ORGANIZATION_ID);
    expect(response.status).toBe(403);
  });

  it('returns 400 when organizationId is missing', async () => {
    const response = await requestFor('case-1', 'payment-1', null);
    expect(response.status).toBe(400);
  });
});

describe('GET .../payments/[paymentId] — lookup', () => {
  it('returns the stored payment when it exists and matches the caseId', async () => {
    const response = await requestFor('case-1', 'payment-1', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.payment.id).toBe('payment-1');
  });

  it('returns 404 for a nonexistent payment id', async () => {
    const response = await requestFor('case-1', 'no-such-payment', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });

  it('returns 404 when the payment exists but belongs to a different case', async () => {
    const response = await requestFor('some-other-case', 'payment-1', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(404);
  });

  it('never attempts reconciliation in mock mode', async () => {
    await requestFor('case-1', 'payment-1', DEFAULT_ORGANIZATION_ID);
    expect(mockGetPaymentStatus).not.toHaveBeenCalled();
  });
});

describe('GET .../payments/[paymentId] — wix-mode reconciliation fallback', () => {
  const INTEGRATION_DATA = {
    beaconIntegrationId: 'org-clover',
    organizationId: DEFAULT_ORGANIZATION_ID,
    provider: 'clover',
    environment: 'sandbox',
    merchantIdReference: 'CLOVER_MOCK_MERCHANT_ID',
    credentialReference: 'CLOVER_MOCK_PRIVATE_KEY',
    webhookSecretReference: 'CLOVER_MOCK_WEBHOOK_SECRET',
    isEnabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    mockQueryWixDataItems = vi.fn().mockImplementation((collectionId: string) => {
      if (collectionId === 'paymentIntegrations') return Promise.resolve({ dataItems: [{ id: 'org-clover', dataCollectionId: 'paymentIntegrations', data: INTEGRATION_DATA }] });
      if (collectionId === 'paymentRecords') {
        return Promise.resolve({
          dataItems: [
            {
              id: 'payment-1',
              dataCollectionId: 'paymentRecords',
              data: {
                beaconPaymentId: 'payment-1',
                organizationId: DEFAULT_ORGANIZATION_ID,
                caseId: 'case-1',
                provider: 'clover',
                providerCheckoutId: 'checkout-1',
                providerPaymentId: null,
                idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`,
                checkoutUrl: 'https://apisandbox.dev.clover.com/checkout-1',
                status: 'pending',
                amount: 1000,
                currency: 'usd',
                purpose: 'Fee',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            },
          ],
        });
      }
      return Promise.resolve({ dataItems: [] });
    });
    mockUpdateWixDataItem = vi.fn().mockImplementation((_c: string, id: string, data: Record<string, unknown>) =>
      Promise.resolve({ id, dataCollectionId: 'paymentRecords', data }),
    );
  });
  afterEach(() => {
    delete process.env.WIX_API_KEY;
    delete process.env.WIX_SITE_ID;
  });

  it('reconciles a pending payment to succeeded via getPaymentStatus and persists the update', async () => {
    mockGetPaymentStatus = vi.fn().mockResolvedValue({
      providerCheckoutId: 'checkout-1',
      providerPaymentId: 'pay-1',
      status: 'succeeded',
      cardBrand: 'visa',
      cardLast4: '4242',
      receiptReference: 'pay-1',
      failureCode: null,
      failureMessage: null,
    });

    const response = await requestFor('case-1', 'payment-1', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.payment.status).toBe('succeeded');
    expect(mockUpdateWixDataItem).toHaveBeenCalled();
  });

  it('reconciliation errors are swallowed — the endpoint still returns the last-known stored status, never a 500', async () => {
    mockGetPaymentStatus = vi.fn().mockRejectedValue(new Error('Clover unreachable'));

    const response = await requestFor('case-1', 'payment-1', DEFAULT_ORGANIZATION_ID);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.payment.status).toBe('pending');
  });

  it('does not attempt reconciliation for an already-terminal status', async () => {
    mockQueryWixDataItems = vi.fn().mockImplementation((collectionId: string) => {
      if (collectionId === 'paymentRecords') {
        return Promise.resolve({
          dataItems: [
            {
              id: 'payment-1',
              dataCollectionId: 'paymentRecords',
              data: {
                beaconPaymentId: 'payment-1',
                organizationId: DEFAULT_ORGANIZATION_ID,
                caseId: 'case-1',
                provider: 'clover',
                providerCheckoutId: 'checkout-1',
                idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`,
                status: 'succeeded',
                amount: 1000,
                currency: 'usd',
                purpose: 'Fee',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            },
          ],
        });
      }
      return Promise.resolve({ dataItems: [] });
    });

    await requestFor('case-1', 'payment-1', DEFAULT_ORGANIZATION_ID);
    expect(mockGetPaymentStatus).not.toHaveBeenCalled();
  });
});
