import { describe, expect, it } from 'vitest';
import {
  resolveReceiptPaymentStatus,
  resolvePaidInFullDate,
  formatReceiptMoney,
  formatReceiptDate,
  receiptPaymentMethodLabel,
  RECEIPT_STATUS_LABEL,
  type ReceiptPaymentLine,
} from './receiptOfPayment';

/**
 * A receipt is a financial assertion made to a bereaved family. "PAID IN
 * FULL" on a case that still owes money is the single worst thing this
 * document can do, so the status rule is pinned hard.
 */
describe('resolveReceiptPaymentStatus', () => {
  it('is PAID IN FULL only when the balance is genuinely cleared', () => {
    expect(resolveReceiptPaymentStatus({ balanceDueCents: 0, paidCents: 89_000 })).toBe('paid_in_full');
    // An overpayment is still cleared.
    expect(resolveReceiptPaymentStatus({ balanceDueCents: -500, paidCents: 89_500 })).toBe('paid_in_full');
  });

  it('is PARTIAL PAYMENT when money has been paid but a balance remains', () => {
    expect(resolveReceiptPaymentStatus({ balanceDueCents: 40_000, paidCents: 49_000 })).toBe('partial_payment');
  });

  it('is BALANCE DUE when nothing has been paid', () => {
    expect(resolveReceiptPaymentStatus({ balanceDueCents: 89_000, paidCents: 0 })).toBe('balance_due');
  });

  it('never reads PAID IN FULL merely because a payment exists', () => {
    const status = resolveReceiptPaymentStatus({ balanceDueCents: 1, paidCents: 88_999 });
    expect(status).not.toBe('paid_in_full');
    expect(RECEIPT_STATUS_LABEL[status]).toBe('PARTIAL PAYMENT');
  });
});

describe('resolvePaidInFullDate', () => {
  const payments: ReceiptPaymentLine[] = [
    { methodLabel: 'Credit Card', paidAtDisplay: 'May 1, 2025', amountCents: 40_000 },
    { methodLabel: 'Check', paidAtDisplay: 'May 21, 2025', amountCents: 49_000 },
  ];

  it('is the date of the payment that cleared the balance', () => {
    expect(resolvePaidInFullDate('paid_in_full', payments)).toBe('May 21, 2025');
  });

  it('is absent unless the balance is actually cleared', () => {
    expect(resolvePaidInFullDate('partial_payment', payments)).toBeNull();
    expect(resolvePaidInFullDate('balance_due', payments)).toBeNull();
  });

  it('is absent when no payment carries a date — never invented', () => {
    expect(resolvePaidInFullDate('paid_in_full', [{ methodLabel: 'Cash', paidAtDisplay: null, amountCents: 100 }])).toBeNull();
  });
});

describe('formatReceiptMoney', () => {
  it('formats integer cents as currency', () => {
    expect(formatReceiptMoney(89_000)).toBe('$890.00');
    expect(formatReceiptMoney(0)).toBe('$0.00');
    expect(formatReceiptMoney(123_456_78)).toBe('$123,456.78');
  });

  it('shows a credit balance in parentheses rather than as a bare minus', () => {
    expect(formatReceiptMoney(-5_000)).toBe('($50.00)');
  });
});

describe('formatReceiptDate', () => {
  it('reads both stored shapes', () => {
    expect(formatReceiptDate('05/21/2025')).toBe('May 21, 2025');
    expect(formatReceiptDate('2025-05-21T18:00:00.000Z')).toBe('May 21, 2025');
  });

  it('is timezone-stable — the date shown is the date stored', () => {
    expect(formatReceiptDate('01/01/2026')).toBe('January 1, 2026');
    expect(formatReceiptDate('2026-01-01T00:30:00.000Z')).toBe('January 1, 2026');
  });

  it('returns null rather than guessing', () => {
    for (const value of [null, undefined, '', '   ', '—', 'unknown', '5/21/25']) {
      expect(formatReceiptDate(value), String(value)).toBeNull();
    }
  });
});

describe('receiptPaymentMethodLabel', () => {
  it('names the card when the record has one', () => {
    expect(receiptPaymentMethodLabel({ provider: 'clover', cardBrand: 'Visa', cardLast4: '4242' })).toBe('Visa ••4242');
    expect(receiptPaymentMethodLabel({ provider: 'clover', cardBrand: 'Visa', cardLast4: null })).toBe('Visa');
  });

  it('falls back to Credit Card for a card terminal with no brand recorded', () => {
    expect(receiptPaymentMethodLabel({ provider: 'clover', cardBrand: null, cardLast4: null })).toBe('Credit Card');
  });

  it('never describes an unknown provider as something it may not be', () => {
    expect(receiptPaymentMethodLabel({ provider: 'check', cardBrand: null, cardLast4: null })).toBe('check');
  });
});
