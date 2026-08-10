import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from '@/services/__mocks__/ledgerFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { paymentRecordFixtures } from '@/services/__mocks__/paymentFixtures';
import { caseOrderFixtures } from '@/services/__mocks__/pricingFixtures';
import { seedChartOfAccounts } from '@/services/chartOfAccountsService';
import type { PaymentRecord } from '@/types/payment';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `refund-route-test-${idCounter}`;
}

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { POST } = await import('./route');

function postRequest(caseId: string, paymentId: string, body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request(`http://localhost/api/cases/${caseId}/payments/${paymentId}/refund`, { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId, paymentId }),
  });
}

const NOW = '2026-08-01T00:00:00.000Z';
let lengths: { ledgerAccounts: number; journalEntries: number; journalEntryLines: number; activityEvents: number; paymentRecords: number; caseOrders: number };
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'mock';
  idCounter = 0;
  mockSession = { user: mockDefaultUser };
  lengths = {
    ledgerAccounts: ledgerAccountFixtures.length,
    journalEntries: journalEntryFixtures.length,
    journalEntryLines: journalEntryLineFixtures.length,
    activityEvents: activityEventFixtures.length,
    paymentRecords: paymentRecordFixtures.length,
    caseOrders: caseOrderFixtures.length,
  };
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
  caseOrderFixtures.push({
    id: 'refund-route-order-1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'refund-route-case-1', status: 'active',
    subtotal: 50_000, discountTotal: 0, taxTotal: 0, total: 50_000, balanceDue: 0, version: 1, createdAt: NOW, updatedAt: NOW,
  });
  const payment: PaymentRecord = {
    id: 'refund-route-payment-1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'refund-route-case-1', caseOrderId: 'refund-route-order-1',
    provider: 'clover', providerCheckoutId: 'checkout-1', providerPaymentId: 'provider-payment-1', idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`,
    checkoutUrl: null, status: 'succeeded', amount: 50_000, currency: 'usd', purpose: 'Cremation service fee',
    cardBrand: null, cardLast4: null, receiptReference: null, failureCode: null, failureMessage: null,
    createdAt: NOW, paidAt: NOW, updatedAt: NOW, initiatedByStaffProfileId: null, depositedInBankDepositId: null,
  };
  paymentRecordFixtures.push(payment);
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  journalEntryFixtures.length = lengths.journalEntries;
  journalEntryLineFixtures.length = lengths.journalEntryLines;
  activityEventFixtures.length = lengths.activityEvents;
  paymentRecordFixtures.length = lengths.paymentRecords;
  caseOrderFixtures.length = lengths.caseOrders;
});

describe('POST /api/cases/[caseId]/payments/[paymentId]/refund', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest('refund-route-case-1', 'refund-route-payment-1', { organizationId: DEFAULT_ORGANIZATION_ID }, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
  });

  it('returns 403 for a role without accounting.post', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await postRequest('refund-route-case-1', 'refund-route-payment-1', { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(403);
  });

  it('refunds the succeeded payment and updates the case balance', async () => {
    const response = await postRequest('refund-route-case-1', 'refund-route-payment-1', { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entry.sourceType).toBe('refund');

    const updatedPayment = paymentRecordFixtures.find((p) => p.id === 'refund-route-payment-1');
    expect(updatedPayment?.status).toBe('refunded');
    const updatedOrder = caseOrderFixtures.find((o) => o.id === 'refund-route-order-1');
    expect(updatedOrder?.balanceDue).toBe(50_000);
  });

  it('returns 400 when refunding an already-refunded payment', async () => {
    await postRequest('refund-route-case-1', 'refund-route-payment-1', { organizationId: DEFAULT_ORGANIZATION_ID });
    const response = await postRequest('refund-route-case-1', 'refund-route-payment-1', { organizationId: DEFAULT_ORGANIZATION_ID });
    expect(response.status).toBe(400);
  });
});
