import { describe, expect, it } from 'vitest';
import { MANUAL_PAYMENT_METHODS, MANUAL_PAYMENT_METHOD_LABEL, isManualPaymentMethod, looksLikeCardNumber } from './manualPaymentMethods';
import { receiptPaymentMethodLabel } from './receiptOfPayment';

describe('manual payment methods (2026-10)', () => {
  it('keeps every earlier method and adds Credit Card', () => {
    expect(MANUAL_PAYMENT_METHODS.map((m) => MANUAL_PAYMENT_METHOD_LABEL[m])).toEqual(['Cash', 'Check', 'Credit Card', 'Other']);
    expect(isManualPaymentMethod('credit_card')).toBe(true);
    expect(isManualPaymentMethod('card')).toBe(false);
  });

  it('a recorded Credit Card payment prints "Credit Card" on receipts', () => {
    expect(receiptPaymentMethodLabel({ provider: 'manual', cardBrand: null, cardLast4: null, receiptReference: 'Credit Card' })).toBe('Credit Card');
    expect(receiptPaymentMethodLabel({ provider: 'manual', cardBrand: null, cardLast4: null, receiptReference: 'Credit Card — APPR 0042' })).toBe('Credit Card — APPR 0042');
  });

  it('recognizes a full card number, however it is typed', () => {
    for (const pan of ['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111', '378282246310005', 'paid with 5555 5555 5555 4444 today']) {
      expect(looksLikeCardNumber(pan)).toBe(true);
    }
  });

  it('leaves approval codes, receipt numbers and last-four alone', () => {
    for (const ok of ['', 'APPR 0042', '4242', 'ending 1111', 'Receipt 000123', '1234567890123', '4111111111111112']) {
      expect(looksLikeCardNumber(ok)).toBe(false);
    }
  });
});
