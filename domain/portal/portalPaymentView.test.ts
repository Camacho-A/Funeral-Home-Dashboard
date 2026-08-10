import { describe, it, expect } from 'vitest';
import { buildPortalPaymentView } from './portalPaymentView';
import type { PaymentRecord } from '../../types/payment';

const PAYMENT: PaymentRecord = {
  id: 'payment-1',
  organizationId: 'org-1',
  caseId: 'case-1',
  caseOrderId: 'case-order-1',
  provider: 'clover',
  providerCheckoutId: 'checkout-abc',
  idempotencyKey: 'org-1:key-1',
  providerPaymentId: 'clover-payment-1',
  status: 'succeeded',
  amount: 50000,
  currency: 'usd',
  purpose: 'Case order balance due',
  checkoutUrl: 'https://checkout.example.com/session',
  cardBrand: 'visa',
  cardLast4: '4242',
  receiptReference: 'RCPT-001',
  failureCode: null,
  failureMessage: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  paidAt: '2026-08-01T00:05:00.000Z',
  updatedAt: '2026-08-01T00:05:00.000Z',
  initiatedByStaffProfileId: null,
  depositedInBankDepositId: null,
};

describe('buildPortalPaymentView', () => {
  it('exposes only family-safe fields', () => {
    expect(buildPortalPaymentView(PAYMENT)).toEqual({
      id: 'payment-1',
      provider: 'clover',
      status: 'succeeded',
      amount: 50000,
      currency: 'usd',
      purpose: 'Case order balance due',
      cardBrand: 'visa',
      cardLast4: '4242',
      receiptReference: 'RCPT-001',
      createdAt: '2026-08-01T00:00:00.000Z',
      paidAt: '2026-08-01T00:05:00.000Z',
    });
  });

  it('never includes provider correlation internals, failure detail, checkoutUrl, or updatedAt', () => {
    const view = buildPortalPaymentView(PAYMENT);
    const keys = Object.keys(view);
    for (const forbidden of [
      'organizationId',
      'caseId',
      'caseOrderId',
      'providerCheckoutId',
      'idempotencyKey',
      'providerPaymentId',
      'checkoutUrl',
      'failureCode',
      'failureMessage',
      'updatedAt',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
