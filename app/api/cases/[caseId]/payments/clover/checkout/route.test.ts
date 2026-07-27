import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { paymentIntegrationFixtures, paymentRecordFixtures } from '@/services/__mocks__/paymentFixtures';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures } from '@/services/__mocks__/pricingFixtures';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import type { CaseOrder } from '@/types/caseOrder';

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

let mockQueryWixDataItems = vi.fn();
let mockInsertWixDataItem = vi.fn();
let mockUpdateWixDataItem = vi.fn();

vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  return {
    queryWixDataItems: (...args: unknown[]) => {
      getWixServerConfig();
      return mockQueryWixDataItems(...args);
    },
    insertWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockInsertWixDataItem(...args);
    },
    updateWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockUpdateWixDataItem(...args);
    },
  };
});

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { POST } = await import('./route');

const KNOWN_CASE = () => caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)!;
const BALANCE_DUE = 120_000;

function seedActiveOrder(caseId: string, balanceDue: number, overrides: Partial<CaseOrder> = {}): CaseOrder {
  const order: CaseOrder = {
    id: `order-${caseId}`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId,
    status: 'active',
    subtotal: balanceDue,
    discountTotal: 0,
    taxTotal: 0,
    total: balanceDue,
    balanceDue,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  caseOrderFixtures.push(order);
  return order;
}

function postRequest(caseId: string, body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request(`http://localhost/api/cases/${caseId}/payments/clover/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost', host: 'localhost', ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ caseId }) },
  );
}

const VALID_BODY = {
  organizationId: DEFAULT_ORGANIZATION_ID,
  purpose: 'Cremation service fee',
  idempotencyKey: 'client-key-1',
};

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  mockQueryWixDataItems = vi.fn();
  mockInsertWixDataItem = vi.fn();
  mockUpdateWixDataItem = vi.fn();
  mockSession = { user: mockDefaultUser };
  paymentRecordFixtures.length = 0;
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseOrderAuditFixtures.length = 0;
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  paymentRecordFixtures.length = 0;
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseOrderAuditFixtures.length = 0;
  vi.unstubAllGlobals();
});

describe('POST .../payments/clover/checkout — authorization', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const response = await postRequest(KNOWN_CASE().id, VALID_BODY, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('returns 401 when there is no session at all', async () => {
    mockSession = null;
    seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const response = await postRequest(KNOWN_CASE().id, VALID_BODY);
    expect(response.status).toBe(401);
  });

  it('returns 403 for a forged organizationId the session has no membership in', async () => {
    seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const response = await postRequest(KNOWN_CASE().id, { ...VALID_BODY, organizationId: SECOND_MOCK_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });
});

describe('POST .../payments/clover/checkout — request validation', () => {
  it('returns 400 for invalid JSON', async () => {
    const response = await POST(
      new Request('http://localhost/x', { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, body: '{not json' }),
      { params: Promise.resolve({ caseId: KNOWN_CASE().id }) },
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 when organizationId is missing', async () => {
    const { organizationId, ...rest } = VALID_BODY;
    void organizationId;
    const response = await postRequest(KNOWN_CASE().id, rest);
    expect(response.status).toBe(400);
  });

  it.each(['cardNumber', 'cardCvv', 'cardExp', 'cvv', 'cardholderName', 'billingZip'])(
    'returns 400 when the request contains the forbidden field "%s"',
    async (key) => {
      const response = await postRequest(KNOWN_CASE().id, { ...VALID_BODY, [key]: 'forged' });
      expect(response.status).toBe(400);
    },
  );

  it.each([0, -100, 1.5, 20_000_000, 'not-a-number', 120_000])(
    'returns 400 whenever amount is supplied at all (%s) — Phase 19C: never client-controlled',
    async (amount) => {
      seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
      const response = await postRequest(KNOWN_CASE().id, { ...VALID_BODY, amount });
      expect(response.status).toBe(400);
    },
  );

  it('falls back to a default purpose when none is supplied — purpose is optional, unlike amount', async () => {
    seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const { purpose: _drop, ...rest } = VALID_BODY;
    void _drop;
    const response = await postRequest(KNOWN_CASE().id, rest);
    expect(response.status).toBe(200);
  });

  it.each(['', '   ', undefined])('returns 400 for a missing/blank idempotencyKey (%s)', async (idempotencyKey) => {
    seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const { idempotencyKey: _drop, ...rest } = VALID_BODY;
    void _drop;
    const response = await postRequest(KNOWN_CASE().id, idempotencyKey === undefined ? rest : { ...rest, idempotencyKey });
    expect(response.status).toBe(400);
  });
});

describe('POST .../payments/clover/checkout — case order checks (mock mode)', () => {
  it('returns 404 for a nonexistent case', async () => {
    const response = await postRequest('no-such-case', VALID_BODY);
    expect(response.status).toBe(404);
  });

  it("returns 404 for a case belonging to a different organization the caller IS authorized for — never leaks another org's case", async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest(KNOWN_CASE().id, { ...VALID_BODY, organizationId: SECOND_MOCK_ORGANIZATION_ID });
    expect(response.status).toBe(404);
  });

  it('returns 422 when the case has no case order yet', async () => {
    const response = await postRequest(KNOWN_CASE().id, VALID_BODY);
    expect(response.status).toBe(422);
  });

  it('returns 400 when the case order has no remaining balance', async () => {
    seedActiveOrder(KNOWN_CASE().id, 0);
    const response = await postRequest(KNOWN_CASE().id, VALID_BODY);
    expect(response.status).toBe(400);
  });

  it('returns 422 when Clover is not enabled for the organization', async () => {
    seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const original = paymentIntegrationFixtures[0];
    paymentIntegrationFixtures[0] = { ...original, isEnabled: false };
    try {
      const response = await postRequest(KNOWN_CASE().id, VALID_BODY);
      expect(response.status).toBe(422);
    } finally {
      paymentIntegrationFixtures[0] = original;
    }
  });
});

describe('POST .../payments/clover/checkout — success and idempotency (mock mode)', () => {
  it('creates a pending payment for exactly the CaseOrder balanceDue, referencing the order, never a Clover credential', async () => {
    const order = seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const response = await postRequest(KNOWN_CASE().id, VALID_BODY);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(typeof body.paymentId).toBe('string');
    expect(typeof body.checkoutUrl).toBe('string');
    expect(JSON.stringify(body)).not.toContain('mock-merchant-id');
    expect(JSON.stringify(body)).not.toMatch(/private.?key/i);

    expect(paymentRecordFixtures).toHaveLength(1);
    expect(paymentRecordFixtures[0].status).toBe('pending');
    expect(paymentRecordFixtures[0].amount).toBe(BALANCE_DUE);
    expect(paymentRecordFixtures[0].caseOrderId).toBe(order.id);
  });

  it('never calls the real Clover API in mock mode', async () => {
    seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await postRequest(KNOWN_CASE().id, VALID_BODY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses the existing pending session on an immediate duplicate request (idempotency)', async () => {
    seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const first = await postRequest(KNOWN_CASE().id, VALID_BODY);
    const firstBody = await first.json();

    const second = await postRequest(KNOWN_CASE().id, VALID_BODY);
    const secondBody = await second.json();

    expect(secondBody.paymentId).toBe(firstBody.paymentId);
    expect(secondBody.checkoutUrl).toBe(firstBody.checkoutUrl);
    expect(paymentRecordFixtures).toHaveLength(1); // never a second record
  });

  it('creates a genuinely new payment attempt with a different idempotencyKey — supports multiple payments per case', async () => {
    seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    await postRequest(KNOWN_CASE().id, VALID_BODY);
    await postRequest(KNOWN_CASE().id, { ...VALID_BODY, purpose: 'Balance due', idempotencyKey: 'client-key-2' });

    expect(paymentRecordFixtures).toHaveLength(2);
  });
});

describe('POST .../payments/clover/checkout — wix mode (real Clover call)', () => {
  // A tiny stateful stand-in for the paymentRecords collection — the
  // checkout route inserts a pending record, then immediately re-queries
  // it (inside updatePaymentRecord) to merge in the Clover session's
  // providerCheckoutId/checkoutUrl; a stateless mock would make that
  // second lookup always miss.
  let insertedRecords: Record<string, Record<string, unknown>>;

  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    process.env.CLOVER_MOCK_MERCHANT_ID = 'merchant-abc';
    process.env.CLOVER_MOCK_PRIVATE_KEY = 'fake-private-key';
    insertedRecords = {};

    mockQueryWixDataItems.mockImplementation((collectionId: string) => {
      if (collectionId === 'cases') {
        return Promise.resolve({
          dataItems: [{ id: KNOWN_CASE().id, dataCollectionId: 'cases', data: buildWixCaseDataFromFixture() }],
        });
      }
      if (collectionId === 'caseOrders') {
        return Promise.resolve({
          dataItems: [
            {
              id: 'order-item-1',
              dataCollectionId: 'caseOrders',
              data: {
                beaconCaseOrderId: 'order-1',
                organizationId: DEFAULT_ORGANIZATION_ID,
                caseId: KNOWN_CASE().id,
                status: 'active',
                subtotal: BALANCE_DUE,
                discountTotal: 0,
                taxTotal: 0,
                total: BALANCE_DUE,
                balanceDue: BALANCE_DUE,
                version: 1,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            },
          ],
        });
      }
      if (collectionId === 'paymentIntegrations') {
        return Promise.resolve({
          dataItems: [
            {
              id: paymentIntegrationFixtures[0].id,
              dataCollectionId: 'paymentIntegrations',
              data: {
                beaconIntegrationId: paymentIntegrationFixtures[0].id,
                organizationId: DEFAULT_ORGANIZATION_ID,
                provider: 'clover',
                environment: 'sandbox',
                merchantIdReference: 'CLOVER_MOCK_MERCHANT_ID',
                credentialReference: 'CLOVER_MOCK_PRIVATE_KEY',
                webhookSecretReference: 'CLOVER_MOCK_WEBHOOK_SECRET',
                isEnabled: true,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            },
          ],
        });
      }
      if (collectionId === 'paymentRecords') {
        const items = Object.entries(insertedRecords).map(([id, data]) => ({ id, dataCollectionId: 'paymentRecords', data }));
        return Promise.resolve({ dataItems: items });
      }
      return Promise.resolve({ dataItems: [] });
    });

    mockInsertWixDataItem.mockImplementation((_collectionId: string, data: Record<string, unknown>, itemId: string) => {
      insertedRecords[itemId] = { ...data, beaconPaymentId: itemId };
      return Promise.resolve({ id: itemId, dataCollectionId: 'paymentRecords', data: insertedRecords[itemId] });
    });
    mockUpdateWixDataItem.mockImplementation((_collectionId: string, itemId: string, data: Record<string, unknown>) => {
      insertedRecords[itemId] = data;
      return Promise.resolve({ id: itemId, dataCollectionId: 'paymentRecords', data });
    });
  });

  function buildWixCaseDataFromFixture() {
    const c = KNOWN_CASE();
    return {
      beaconCaseId: c.id,
      organizationId: c.organizationId,
      caseNumber: c.caseNumber,
      caseType: c.caseType,
      workflowTemplateId: c.workflowTemplateId,
      workflowTemplateVersion: c.workflowTemplateVersion,
      workflowSnapshot: c.workflowSnapshot,
      intakeOwnerId: c.intakeOwnerId,
      caseHandlerId: c.assignedStaffId,
      currentStage: c.rawStage,
      checklistState: c.checklistState,
      fieldValues: c.fieldValues,
      decedentName: c.decedentName,
      dateOfBirth: c.dateOfBirth,
      dateOfDeath: c.dateOfDeath,
      timeOfDeath: c.timeOfDeath,
      placeOfDeath: c.placeOfDeath,
      weight: c.weight,
      nextOfKinName: c.nextOfKinName,
      nextOfKinPhone: c.nextOfKinPhone,
      paymentStatus: c.paymentStatus,
      isVeteran: c.isVeteran,
      isArchived: c.isDeleted,
      createdBy: c.createdBy,
      createdAt: c.createdAt,
    };
  }

  afterEach(() => {
    delete process.env.CLOVER_MOCK_MERCHANT_ID;
    delete process.env.CLOVER_MOCK_PRIVATE_KEY;
  });

  it('maps a successful Clover Hosted Checkout session to the response, using the CaseOrder balanceDue as the amount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          href: 'https://apisandbox.dev.clover.com/checkout-real-1',
          checkoutSessionId: 'checkout-real-1',
          createdTime: 1,
          expirationTime: 2,
        }),
      }),
    );

    const response = await postRequest(KNOWN_CASE().id, VALID_BODY);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.checkoutUrl).toBe('https://apisandbox.dev.clover.com/checkout-real-1');
    expect(mockInsertWixDataItem).toHaveBeenCalledWith(
      'paymentRecords',
      expect.objectContaining({ amount: BALANCE_DUE, caseOrderId: 'order-1' }),
      expect.any(String),
    );
    expect(mockUpdateWixDataItem).toHaveBeenCalledWith(
      'paymentRecords',
      expect.any(String),
      expect.objectContaining({ providerCheckoutId: 'checkout-real-1', checkoutUrl: 'https://apisandbox.dev.clover.com/checkout-real-1' }),
    );
  });

  it('propagates a Clover API failure as a 503, leaving the pending record intact for a retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const response = await postRequest(KNOWN_CASE().id, VALID_BODY);
    expect(response.status).toBe(503);
    expect(mockInsertWixDataItem).toHaveBeenCalled(); // the pending record was still created
  });
});
