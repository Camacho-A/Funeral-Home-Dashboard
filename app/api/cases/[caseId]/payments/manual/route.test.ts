import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { paymentRecordFixtures } from '@/services/__mocks__/paymentFixtures';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures } from '@/services/__mocks__/pricingFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from '@/services/__mocks__/ledgerFixtures';
import { seedChartOfAccounts } from '@/services/chartOfAccountsService';
import type { CaseOrder } from '@/types/caseOrder';

let idCounter = 0;
const idFactory = () => `manual-pay-test-${(idCounter += 1)}`;

const ENV_KEYS = ['DATA_ADAPTER'] as const;
let originalEnv: Record<string, string | undefined>;

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
    new Request(`http://localhost/api/cases/${caseId}/payments/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost', host: 'localhost', ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ caseId }) },
  );
}

const VALID_BODY = {
  organizationId: DEFAULT_ORGANIZATION_ID,
  method: 'cash',
  amountCents: 50_000,
  idempotencyKey: 'manual-key-1',
};

beforeEach(async () => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  mockSession = { user: mockDefaultUser };
  paymentRecordFixtures.length = 0;
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseOrderAuditFixtures.length = 0;
  activityEventFixtures.length = 0;
  ledgerAccountFixtures.length = 0;
  journalEntryFixtures.length = 0;
  journalEntryLineFixtures.length = 0;
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
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
  activityEventFixtures.length = 0;
  ledgerAccountFixtures.length = 0;
  journalEntryFixtures.length = 0;
  journalEntryLineFixtures.length = 0;
});

describe('POST .../payments/manual — authorization', () => {
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
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest(KNOWN_CASE().id, { ...VALID_BODY, organizationId: 'not-a-real-org' });
    expect(response.status).toBe(403);
  });

  it('rejects a request body carrying raw card data', async () => {
    seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const response = await postRequest(KNOWN_CASE().id, { ...VALID_BODY, cardNumber: '4111111111111111' });
    expect(response.status).toBe(400);
  });
});

describe('POST .../payments/manual — validation', () => {
  it('rejects a missing/invalid method', async () => {
    seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const response = await postRequest(KNOWN_CASE().id, { ...VALID_BODY, method: 'bitcoin' });
    expect(response.status).toBe(400);
  });

  it('rejects a non-positive or non-integer amount', async () => {
    seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    expect((await postRequest(KNOWN_CASE().id, { ...VALID_BODY, amountCents: 0 })).status).toBe(400);
    expect((await postRequest(KNOWN_CASE().id, { ...VALID_BODY, amountCents: -100 })).status).toBe(400);
    expect((await postRequest(KNOWN_CASE().id, { ...VALID_BODY, amountCents: 10.5 })).status).toBe(400);
  });

  it('rejects an amount greater than the current balance due', async () => {
    seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const response = await postRequest(KNOWN_CASE().id, { ...VALID_BODY, amountCents: BALANCE_DUE + 1 });
    expect(response.status).toBe(400);
  });

  it('rejects a case with no active order', async () => {
    const response = await postRequest(KNOWN_CASE().id, VALID_BODY);
    expect(response.status).toBe(422);
  });

  it('rejects a case order with no remaining balance', async () => {
    seedActiveOrder(KNOWN_CASE().id, 0);
    const response = await postRequest(KNOWN_CASE().id, { ...VALID_BODY, amountCents: 100 });
    expect(response.status).toBe(400);
  });

  it('404s for a case that does not belong to this organization', async () => {
    const response = await postRequest('not-a-real-case', VALID_BODY);
    expect(response.status).toBe(404);
  });
});

describe('POST .../payments/manual — success', () => {
  it('records a full-balance cash payment, posts it as succeeded, and zeroes the balance', async () => {
    const order = seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const response = await postRequest(KNOWN_CASE().id, { ...VALID_BODY, amountCents: BALANCE_DUE });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.payment.status).toBe('succeeded');
    expect(body.payment.provider).toBe('manual');
    expect(body.payment.amount).toBe(BALANCE_DUE);
    expect(body.payment.receiptReference).toBe('Cash');
    expect(body.payment.paidAt).toBeTruthy();

    const refreshedOrder = caseOrderFixtures.find((o) => o.id === order.id)!;
    expect(refreshedOrder.balanceDue).toBe(0);
  });

  it('records a partial (deposit) payment and leaves a remaining balance', async () => {
    const order = seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const response = await postRequest(KNOWN_CASE().id, { ...VALID_BODY, amountCents: 50_000 });
    expect(response.status).toBe(201);
    const refreshedOrder = caseOrderFixtures.find((o) => o.id === order.id)!;
    expect(refreshedOrder.balanceDue).toBe(BALANCE_DUE - 50_000);
  });

  it('combines the method label and an optional reference into receiptReference', async () => {
    seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const response = await postRequest(KNOWN_CASE().id, { ...VALID_BODY, method: 'check', reference: '1234', amountCents: 50_000 });
    const body = await response.json();
    expect(body.payment.receiptReference).toBe('Check — 1234');
  });

  it('is idempotent: replaying the same idempotencyKey never double-posts', async () => {
    const order = seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const first = await postRequest(KNOWN_CASE().id, { ...VALID_BODY, amountCents: 50_000 });
    expect(first.status).toBe(201);
    const second = await postRequest(KNOWN_CASE().id, { ...VALID_BODY, amountCents: 50_000 });
    expect(second.status).toBe(200);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.payment.id).toBe(firstBody.payment.id);
    // balance reflects exactly one 50_000 payment, not two
    const refreshedOrder = caseOrderFixtures.find((o) => o.id === order.id)!;
    expect(refreshedOrder.balanceDue).toBe(BALANCE_DUE - 50_000);
  });

  it('records a payment.recorded activity event', async () => {
    seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    await postRequest(KNOWN_CASE().id, { ...VALID_BODY, amountCents: 50_000 });
    expect(activityEventFixtures.some((e) => e.eventType === 'payment.recorded')).toBe(true);
  });

  it('never stores raw card data anywhere on the created record', async () => {
    seedActiveOrder(KNOWN_CASE().id, BALANCE_DUE);
    const response = await postRequest(KNOWN_CASE().id, { ...VALID_BODY, amountCents: 50_000 });
    const body = await response.json();
    expect(body.payment.cardBrand).toBeNull();
    expect(body.payment.cardLast4).toBeNull();
  });
});
