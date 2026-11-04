import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { paymentRecordFixtures } from '@/services/__mocks__/paymentFixtures';
import { caseOrderFixtures } from '@/services/__mocks__/pricingFixtures';
import { caseWriteOffFixtures } from '@/services/__mocks__/ledgerFixtures';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import type { PaymentRecord } from '@/types/payment';
import type { CaseOrder } from '@/types/caseOrder';

/**
 * Case balance and overpayment (2026-11). Fictional cases and amounts only.
 */
let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { GET } = await import('./route');

const ORG = DEFAULT_ORGANIZATION_ID;
const OTHER = SECOND_MOCK_ORGANIZATION_ID;
const NOW = '2026-11-01T00:00:00.000Z';

const balanceFor = (caseId: string, organizationId: string | null = ORG) =>
  GET(new Request(`http://localhost/api/cases/${caseId}/payments/balance${organizationId ? `?organizationId=${organizationId}` : ''}`), { params: Promise.resolve({ caseId }) });

const order = (o: Partial<CaseOrder> & Pick<CaseOrder, 'id' | 'organizationId' | 'caseId' | 'total'>): CaseOrder => ({
  status: 'active', subtotal: o.total, discountTotal: 0, taxTotal: 0, balanceDue: 0, version: 1, createdAt: NOW, updatedAt: NOW, ...o,
});
const payment = (id: string, organizationId: string, caseId: string, amount: number, status: PaymentRecord['status'] = 'succeeded'): PaymentRecord => ({
  id, organizationId, caseId, caseOrderId: null, provider: 'manual', providerCheckoutId: `manual:${id}`, providerPaymentId: null,
  idempotencyKey: `${organizationId}:${id}`, checkoutUrl: null, status, amount, currency: 'usd', purpose: 'Fictional payment',
  cardBrand: null, cardLast4: null, receiptReference: null, failureCode: null, failureMessage: null,
  createdAt: NOW, paidAt: NOW, updatedAt: NOW, initiatedByStaffProfileId: null, depositedInBankDepositId: null,
});

let orders: CaseOrder[];
beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  orders = structuredClone(caseOrderFixtures);
  paymentRecordFixtures.length = 0;
  caseWriteOffFixtures.length = 0;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  caseOrderFixtures.splice(0, caseOrderFixtures.length, ...orders);
  paymentRecordFixtures.length = 0;
  caseWriteOffFixtures.length = 0;
});

describe('GET /api/cases/[caseId]/payments/balance', () => {
  it('reports the exact overpayment when the order total falls below what was paid — and changes nothing', async () => {
    caseOrderFixtures.push(order({ id: 'ov-order-2', organizationId: ORG, caseId: 'ov-case', total: 150_000, version: 2 }));
    paymentRecordFixtures.push(payment('ov-p1', ORG, 'ov-case', 189_500), payment('ov-p2', ORG, 'ov-case', 20_000, 'pending'), payment('ov-p3', ORG, 'ov-case', 5_000, 'failed'));
    const before = structuredClone(paymentRecordFixtures);

    const response = await balanceFor('ov-case');
    expect(response.status).toBe(200);
    expect((await response.json()).balance).toEqual({ orderTotalCents: 150_000, paidCents: 189_500, writeOffCents: 0, balanceDueCents: 0, overpaymentCents: 39_500 });
    expect(paymentRecordFixtures).toEqual(before);
  });

  it('a refunded payment no longer counts, and write-offs never create an overpayment', async () => {
    caseOrderFixtures.push(order({ id: 'wo-order', organizationId: ORG, caseId: 'wo-case', total: 100_000 }));
    paymentRecordFixtures.push(payment('wo-p1', ORG, 'wo-case', 70_000), payment('wo-p2', ORG, 'wo-case', 50_000, 'refunded'));
    caseWriteOffFixtures.push({ id: 'wo-1', organizationId: ORG, caseId: 'wo-case', amount: 30_000, journalEntryId: 'je-fictional', reason: 'Fictional', performedByStaffProfileId: null, createdAt: NOW });
    expect((await (await balanceFor('wo-case')).json()).balance).toMatchObject({ paidCents: 70_000, balanceDueCents: 0, overpaymentCents: 0 });
  });

  it('null when the case has no order', async () => {
    expect((await (await balanceFor('no-order-case')).json()).balance).toBeNull();
  });

  it("never counts another organization's payments or orders for the same case id", async () => {
    caseOrderFixtures.push(order({ id: 'iso-order', organizationId: ORG, caseId: 'iso-case', total: 100_000 }), order({ id: 'iso-other', organizationId: OTHER, caseId: 'iso-case', total: 1_000 }));
    paymentRecordFixtures.push(payment('iso-p1', ORG, 'iso-case', 40_000), payment('iso-p2', OTHER, 'iso-case', 500_000));
    expect((await (await balanceFor('iso-case')).json()).balance).toMatchObject({ orderTotalCents: 100_000, paidCents: 40_000, balanceDueCents: 60_000, overpaymentCents: 0 });
  });

  it('refuses a forged organization (403), no session (401), a missing organizationId (400), and staff without payment.read (403)', async () => {
    expect((await balanceFor('iso-case', OTHER)).status).toBe(403);
    expect((await balanceFor('iso-case', null)).status).toBe(400);
    mockSession = { user: mockMultiOrgUser };
    expect((await balanceFor('iso-case')).status).toBe(403);
    mockSession = null;
    expect((await balanceFor('iso-case')).status).toBe(401);
  });
});
