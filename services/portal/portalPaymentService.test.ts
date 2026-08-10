import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { paymentRecordFixtures } from '../__mocks__/paymentFixtures';
import { caseOrderFixtures } from '../__mocks__/pricingFixtures';
import { DEFAULT_ORGANIZATION_ID } from '../__mocks__/organizationIds';
import type { CaseOrder } from '../../types/caseOrder';

function makeOrder(overrides: Partial<CaseOrder> = {}): CaseOrder {
  return {
    id: 'case-order-portal-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-portal-1',
    status: 'active',
    subtotal: 50000,
    discountTotal: 0,
    taxTotal: 0,
    total: 50000,
    balanceDue: 50000,
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

let lengths: { payments: number; orders: number };
beforeEach(() => {
  lengths = { payments: paymentRecordFixtures.length, orders: caseOrderFixtures.length };
});
afterEach(() => {
  paymentRecordFixtures.length = lengths.payments;
  caseOrderFixtures.length = lengths.orders;
});

describe('portalPaymentService', () => {
  describe('listFamilyPaymentHistory', () => {
    it('maps every payment record for the case through the allowlisting DTO', async () => {
      paymentRecordFixtures.push({
        id: 'payment-portal-1',
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-portal-1',
        caseOrderId: 'case-order-portal-1',
        provider: 'clover',
        providerCheckoutId: 'checkout-1',
        idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`,
        providerPaymentId: 'clover-payment-1',
        status: 'succeeded',
        amount: 50000,
        currency: 'usd',
        purpose: 'Case order balance due',
        checkoutUrl: null,
        cardBrand: 'visa',
        cardLast4: '4242',
        receiptReference: 'RCPT-1',
        failureCode: null,
        failureMessage: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        paidAt: '2026-08-01T00:05:00.000Z',
        updatedAt: '2026-08-01T00:05:00.000Z',
        initiatedByStaffProfileId: null,
        depositedInBankDepositId: null,
      });

      const { listFamilyPaymentHistory } = await import('./portalPaymentService');
      const history = await listFamilyPaymentHistory(DEFAULT_ORGANIZATION_ID, 'case-portal-1', 'mock');

      expect(history).toHaveLength(1);
      expect(history[0]).not.toHaveProperty('providerCheckoutId');
      expect(history[0]).not.toHaveProperty('idempotencyKey');
      expect(history[0].receiptReference).toBe('RCPT-1');
    });
  });

  describe('initiateFamilyCheckout', () => {
    it('resolves the amount from the active CaseOrder.balanceDue — never accepted as an input', async () => {
      caseOrderFixtures.push(makeOrder({ balanceDue: 32500 }));

      const { initiateFamilyCheckout } = await import('./portalPaymentService');
      const result = await initiateFamilyCheckout(
        {
          organizationId: DEFAULT_ORGANIZATION_ID,
          caseId: 'case-portal-1',
          idempotencyKey: 'family-checkout-key-1',
          returnUrl: 'http://localhost:3000/family/cases/case-portal-1/payments/return?outcome=success',
          cancelUrl: 'http://localhost:3000/family/cases/case-portal-1/payments/return?outcome=cancel',
        },
        'mock',
      );

      expect(result.checkoutUrl).toContain('mock=1');
      const record = paymentRecordFixtures.find((p) => p.id === result.paymentId);
      expect(record?.amount).toBe(32500);
    });

    it('refuses to check out a case with no active CaseOrder', async () => {
      const { initiateFamilyCheckout, PortalPaymentServiceError } = await import('./portalPaymentService');
      await expect(
        initiateFamilyCheckout(
          { organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-no-order', idempotencyKey: 'key', returnUrl: 'x', cancelUrl: 'y' },
          'mock',
        ),
      ).rejects.toThrow(PortalPaymentServiceError);
    });

    it('refuses to check out a case order with a zero balance', async () => {
      caseOrderFixtures.push(makeOrder({ caseId: 'case-paid-off', balanceDue: 0 }));

      const { initiateFamilyCheckout, PortalPaymentServiceError } = await import('./portalPaymentService');
      await expect(
        initiateFamilyCheckout(
          { organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-paid-off', idempotencyKey: 'key', returnUrl: 'x', cancelUrl: 'y' },
          'mock',
        ),
      ).rejects.toThrow(PortalPaymentServiceError);
    });
  });

  describe('getFamilyPaymentStatus', () => {
    it('returns the DTO for a payment belonging to this case', async () => {
      caseOrderFixtures.push(makeOrder({ balanceDue: 10000 }));
      const { initiateFamilyCheckout, getFamilyPaymentStatus } = await import('./portalPaymentService');
      const result = await initiateFamilyCheckout(
        { organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-portal-1', idempotencyKey: 'status-key-1', returnUrl: 'x', cancelUrl: 'y' },
        'mock',
      );

      const status = await getFamilyPaymentStatus(DEFAULT_ORGANIZATION_ID, 'case-portal-1', result.paymentId, 'mock');
      expect(status?.id).toBe(result.paymentId);
      expect(status).not.toHaveProperty('providerCheckoutId');
    });

    it('returns null for a payment belonging to a different case', async () => {
      caseOrderFixtures.push(makeOrder({ balanceDue: 10000 }));
      const { initiateFamilyCheckout, getFamilyPaymentStatus } = await import('./portalPaymentService');
      const result = await initiateFamilyCheckout(
        { organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-portal-1', idempotencyKey: 'status-key-2', returnUrl: 'x', cancelUrl: 'y' },
        'mock',
      );

      expect(await getFamilyPaymentStatus(DEFAULT_ORGANIZATION_ID, 'a-different-case', result.paymentId, 'mock')).toBeNull();
    });
  });
});
