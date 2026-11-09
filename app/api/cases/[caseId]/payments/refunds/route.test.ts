import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { paymentRecordFixtures } from '@/services/__mocks__/paymentFixtures';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures } from '@/services/__mocks__/pricingFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { mockDefaultUser, mockManagerUser, mockAccountingUser } from '@/services/__mocks__/authFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from '@/services/__mocks__/ledgerFixtures';
import { seedChartOfAccounts } from '@/services/chartOfAccountsService';
import { STARTER_ACCOUNT_NUMBERS } from '@/domain/ledger/starterChartOfAccounts';
import type { CaseOrder } from '@/types/caseOrder';
import type { PaymentRecord } from '@/types/payment';

/** The Statement/Receipt regeneration runs after the response; captured here. */
const { runAfterResponse } = vi.hoisted(() => ({ runAfterResponse: vi.fn() }));
vi.mock('@/lib/afterResponse', () => ({ runAfterResponse }));

let idCounter = 0;
const idFactory = () => `refund-test-${(idCounter += 1)}`;

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { POST } = await import('./route');

const ACTIVE_CASE = () => caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)!;

function seedOrder(caseId: string, total: number, balanceDue: number): CaseOrder {
  const order: CaseOrder = {
    id: `order-${caseId}`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId,
    status: 'active',
    subtotal: total,
    discountTotal: 0,
    taxTotal: 0,
    total,
    balanceDue,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  caseOrderFixtures.push(order);
  return order;
}

function seedPayment(caseId: string, amount: number, id = `pay-${(idCounter += 1)}`): PaymentRecord {
  const record: PaymentRecord = {
    id,
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId,
    caseOrderId: `order-${caseId}`,
    provider: 'manual',
    providerCheckoutId: `manual:${id}`,
    providerPaymentId: null,
    idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:${id}`,
    checkoutUrl: null,
    status: 'succeeded',
    amount,
    currency: 'usd',
    purpose: 'Case order balance due',
    cardBrand: null,
    cardLast4: null,
    receiptReference: 'Check — 1042',
    failureCode: null,
    failureMessage: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    paidAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    initiatedByStaffProfileId: null,
    depositedInBankDepositId: null,
  };
  paymentRecordFixtures.push(record);
  return record;
}

function postRefund(caseId: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return POST(
    new Request(`http://localhost/api/cases/${caseId}/payments/refunds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost', host: 'localhost', ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ caseId }) },
  );
}

const body = (overrides: Record<string, unknown> = {}) => ({
  organizationId: DEFAULT_ORGANIZATION_ID,
  kind: 'overpaid',
  method: 'check',
  amountCents: 10_000,
  reference: '2001',
  reason: 'Paid twice by mistake',
  idempotencyKey: `refund-key-${(idCounter += 1)}`,
  ...overrides,
});

function reset() {
  paymentRecordFixtures.length = 0;
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseOrderAuditFixtures.length = 0;
  activityEventFixtures.length = 0;
  ledgerAccountFixtures.length = 0;
  journalEntryFixtures.length = 0;
  journalEntryLineFixtures.length = 0;
  runAfterResponse.mockClear();
}

beforeEach(async () => {
  delete process.env.DATA_ADAPTER;
  mockSession = { user: mockDefaultUser };
  reset();
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
});

afterEach(() => {
  reset();
});

function ledgerLines(refundId: string) {
  const entry = journalEntryFixtures.find((e) => e.sourceType === 'refund' && e.sourceReferenceId === refundId);
  if (!entry) return null;
  const accountNumber = (accountId: string) => ledgerAccountFixtures.find((a) => a.id === accountId)?.accountNumber;
  return journalEntryLineFixtures
    .filter((l) => l.journalEntryId === entry.id)
    .map((l) => ({ account: accountNumber(l.accountId), direction: l.direction, amount: l.amount }));
}

describe('POST .../payments/refunds — who may refund', () => {
  it('rejects a cross-site request', async () => {
    const response = await postRefund(ACTIVE_CASE().id, body(), { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('requires payment.refund — a Manager (who can record payments) cannot refund', async () => {
    mockSession = { user: mockManagerUser };
    seedOrder(ACTIVE_CASE().id, 100_000, 0);
    seedPayment(ACTIVE_CASE().id, 110_000);
    const response = await postRefund(ACTIVE_CASE().id, body());
    expect(response.status).toBe(403);
    expect(paymentRecordFixtures.filter((p) => p.status === 'refund_issued')).toHaveLength(0);
  });

  it('Accounting can refund', async () => {
    mockSession = { user: mockAccountingUser };
    seedOrder(ACTIVE_CASE().id, 100_000, 0);
    seedPayment(ACTIVE_CASE().id, 110_000);
    const response = await postRefund(ACTIVE_CASE().id, body());
    expect(response.status).toBe(201);
  });
});

describe('POST .../payments/refunds — family overpaid', () => {
  it('records the refund as its own row, leaves the payment untouched, keeps the balance at $0, and posts Dr A/R / Cr Undeposited Funds', async () => {
    const caseId = ACTIVE_CASE().id;
    seedOrder(caseId, 100_000, 0);
    const payment = seedPayment(caseId, 110_000);

    const response = await postRefund(caseId, body({ amountCents: 10_000 }));
    expect(response.status).toBe(201);
    const { refund } = await response.json();
    expect(refund).toMatchObject({ status: 'refund_issued', amount: 10_000, purpose: 'refund_overpaid', provider: 'manual', receiptReference: 'Check — 2001' });

    expect(paymentRecordFixtures.find((p) => p.id === payment.id)?.status).toBe('succeeded');
    expect(caseOrderFixtures.find((o) => o.caseId === caseId)?.balanceDue).toBe(0);
    expect(ledgerLines(refund.id)).toEqual([
      { account: STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, direction: 'debit', amount: 10_000 },
      { account: STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, direction: 'credit', amount: 10_000 },
    ]);
    const event = activityEventFixtures.find((e) => e.eventType === 'payment.refunded' && e.resourceId === refund.id);
    expect(event?.description).toBe('Refund of $100.00 recorded (Family overpaid) — Check — 2001. Reason: Paid twice by mistake');
    expect(runAfterResponse).toHaveBeenCalledTimes(1);
  });

  it('can never be more than was overpaid — a refund never reopens a balance', async () => {
    const caseId = ACTIVE_CASE().id;
    seedOrder(caseId, 100_000, 0);
    seedPayment(caseId, 110_000);
    const response = await postRefund(caseId, body({ amountCents: 10_001 }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.maxRefundCents).toBe(10_000);
    expect(json.error).toContain('overpaid by $100.00');
    expect(paymentRecordFixtures.filter((p) => p.status === 'refund_issued')).toHaveLength(0);
  });

  it('is refused when nothing was overpaid, pointing staff to the other reason', async () => {
    const caseId = ACTIVE_CASE().id;
    seedOrder(caseId, 100_000, 0);
    seedPayment(caseId, 100_000);
    const response = await postRefund(caseId, body({ amountCents: 5_000 }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Service removed or price lowered");
  });
});

describe('POST .../payments/refunds — service removed or price lowered', () => {
  it('lowers the charges by the refund, so the balance stays $0, and posts Dr Service Revenue / Cr Undeposited Funds', async () => {
    const caseId = ACTIVE_CASE().id;
    seedOrder(caseId, 100_000, 0);
    seedPayment(caseId, 100_000);

    const response = await postRefund(caseId, body({ kind: 'charges_reduced', amountCents: 25_000, method: 'cash', reference: undefined }));
    expect(response.status).toBe(201);
    const { refund } = await response.json();
    expect(refund).toMatchObject({ purpose: 'refund_charges_reduced', receiptReference: 'Cash' });
    expect(caseOrderFixtures.find((o) => o.caseId === caseId)?.balanceDue).toBe(0);
    expect(ledgerLines(refund.id)).toEqual([
      { account: STARTER_ACCOUNT_NUMBERS.SERVICE_REVENUE, direction: 'debit', amount: 25_000 },
      { account: STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, direction: 'credit', amount: 25_000 },
    ]);
  });

  it('a partly paid case keeps the same balance due after the refund', async () => {
    const caseId = ACTIVE_CASE().id;
    seedOrder(caseId, 100_000, 40_000);
    seedPayment(caseId, 60_000);
    const response = await postRefund(caseId, body({ kind: 'charges_reduced', amountCents: 20_000 }));
    expect(response.status).toBe(201);
    expect(caseOrderFixtures.find((o) => o.caseId === caseId)?.balanceDue).toBe(40_000);
  });

  it('can never be more than was paid', async () => {
    const caseId = ACTIVE_CASE().id;
    seedOrder(caseId, 100_000, 0);
    seedPayment(caseId, 100_000);
    await postRefund(caseId, body({ kind: 'charges_reduced', amountCents: 90_000 }));
    const response = await postRefund(caseId, body({ kind: 'charges_reduced', amountCents: 10_001 }));
    expect(response.status).toBe(400);
    expect((await response.json()).maxRefundCents).toBe(10_000);
  });
});

describe('POST .../payments/refunds — archived cases and repeats', () => {
  it('works on an archived case and leaves it archived', async () => {
    const archived = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && c.isDeleted);
    const target = archived ?? ACTIVE_CASE();
    const restore = target.isDeleted;
    target.isDeleted = true;
    try {
      seedOrder(target.id, 100_000, 0);
      seedPayment(target.id, 100_000);
      const response = await postRefund(target.id, body({ kind: 'charges_reduced', amountCents: 30_000 }));
      expect(response.status).toBe(201);
      expect(target.isDeleted).toBe(true);
    } finally {
      target.isDeleted = restore;
    }
  });

  it('the same request twice records one refund and one ledger entry', async () => {
    const caseId = ACTIVE_CASE().id;
    seedOrder(caseId, 100_000, 0);
    seedPayment(caseId, 110_000);
    const request = body({ idempotencyKey: 'same-refund' });
    const first = await postRefund(caseId, request);
    const second = await postRefund(caseId, request);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(paymentRecordFixtures.filter((p) => p.status === 'refund_issued')).toHaveLength(1);
    expect(journalEntryFixtures.filter((e) => e.sourceType === 'refund')).toHaveLength(1);
  });

  it('needs a reason, a known reason type, a method and a positive amount; never a card number', async () => {
    const caseId = ACTIVE_CASE().id;
    seedOrder(caseId, 100_000, 0);
    seedPayment(caseId, 110_000);
    for (const bad of [
      { reason: '  ' },
      { kind: 'goodwill' },
      { method: 'wire' },
      { amountCents: 0 },
      { amountCents: 10.5 },
      { method: 'credit_card', reference: '4111 1111 1111 1111' },
    ]) {
      const response = await postRefund(caseId, body(bad));
      expect(response.status, JSON.stringify(bad)).toBe(400);
    }
    expect(paymentRecordFixtures.filter((p) => p.status === 'refund_issued')).toHaveLength(0);
  });

  it('a case from another organization is not found', async () => {
    const response = await postRefund('no-such-case', body());
    expect(response.status).toBe(404);
  });
});

describe('POST .../payments/refunds — Gus Camacho and order changes (shared platform, 2026-11)', () => {
  it('a Gus administrator refunds a Gus case — the same rules, scoped to Gus', async () => {
    const { GUS_ORGANIZATION_ID } = await import('@/services/__mocks__/organizationIds');
    const { mockMembershipFixtures } = await import('@/services/__mocks__/authFixtures');
    await seedChartOfAccounts(GUS_ORGANIZATION_ID, idFactory, 'mock');
    const gusCase = caseFixtures.find((c) => c.organizationId === GUS_ORGANIZATION_ID)!;
    // The default mock user, given a Gus administrator membership for this test only.
    mockMembershipFixtures.push({ organizationId: GUS_ORGANIZATION_ID, userId: mockDefaultUser.id, role: 'administrator', isActive: true });
    try {
    caseOrderFixtures.push({ ...seedOrderRow(gusCase.id, 189_500, 0), organizationId: GUS_ORGANIZATION_ID });
    paymentRecordFixtures.push({ ...seedPaymentRow(gusCase.id, 189_500), organizationId: GUS_ORGANIZATION_ID, idempotencyKey: `${GUS_ORGANIZATION_ID}:gus-pay` });

    const response = await postRefund(gusCase.id, body({ organizationId: GUS_ORGANIZATION_ID, kind: 'charges_reduced', amountCents: 25_000 }));
    expect(response.status).toBe(201);
    const { refund } = await response.json();
    expect(refund).toMatchObject({ organizationId: GUS_ORGANIZATION_ID, caseId: gusCase.id, status: 'refund_issued' });
    expect(caseOrderFixtures.find((o) => o.caseId === gusCase.id)?.balanceDue).toBe(0);

    // A Manors case is not found from Gus.
    const manorsCase = ACTIVE_CASE();
    expect((await postRefund(manorsCase.id, body({ organizationId: GUS_ORGANIZATION_ID }))).status).toBe(404);
    } finally {
      const index = mockMembershipFixtures.findIndex((m) => m.organizationId === GUS_ORGANIZATION_ID && m.userId === mockDefaultUser.id);
      if (index !== -1) mockMembershipFixtures.splice(index, 1);
    }
  });

  it('is paused (409, nothing written) while a change to the services is unfinished — like a payment', async () => {
    const caseId = ACTIVE_CASE().id;
    seedOrder(caseId, 100_000, 0);
    seedPayment(caseId, 110_000);
    caseOrderFixtures.push({ ...seedOrderRow(caseId, 90_000, 0), id: `pending-${caseId}`, status: 'pending', version: 2, createdAt: new Date().toISOString() } as CaseOrder);
    const response = await postRefund(caseId, body());
    expect(response.status).toBe(409);
    expect(paymentRecordFixtures.filter((p) => p.status === 'refund_issued')).toHaveLength(0);
  });
});

function seedOrderRow(caseId: string, total: number, balanceDue: number): CaseOrder {
  return {
    id: `order-${caseId}`, organizationId: DEFAULT_ORGANIZATION_ID, caseId, status: 'active', subtotal: total, discountTotal: 0, taxTotal: 0,
    total, balanceDue, version: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as CaseOrder;
}

function seedPaymentRow(caseId: string, amount: number): PaymentRecord {
  const before = paymentRecordFixtures.length;
  const record = seedPayment(caseId, amount, `gus-pay-${before}`);
  paymentRecordFixtures.pop();
  return record;
}
