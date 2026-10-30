import { describe, expect, it } from 'vitest';
import { summarizeCasePayment, type PaymentSummaryRecord } from './casePaymentSummary';

const order = (total: number, balanceDue: number) => ({ total, balanceDue });
const pay = (id: string, status: PaymentSummaryRecord['status'], amount: number): PaymentSummaryRecord => ({ id, status, amount });

describe('case payment summary — follows verified payment records', () => {
  it('no Case Order, or a $0 one: nothing to derive — the stored value stands alone', () => {
    expect(summarizeCasePayment({ order: null, payments: [], recordedStatus: 'awaiting_payment' })).toBeNull();
    expect(summarizeCasePayment({ order: undefined, payments: undefined, recordedStatus: 'paid_in_full' })).toBeNull();
    expect(summarizeCasePayment({ order: order(0, 0), payments: [], recordedStatus: 'awaiting_payment' })).toBeNull();
  });

  it('unpaid', () => {
    const s = summarizeCasePayment({ order: order(89000, 89000), payments: [], recordedStatus: 'awaiting_payment' })!;
    expect(s.state).toBe('awaiting_payment');
    expect(s.label).toBe('Awaiting payment');
    expect(s.detail).toBe('$890.00 due');
    expect(s.tone).toBe('neutral');
    expect(s.mismatch).toBeNull();
  });

  it('partially paid', () => {
    const s = summarizeCasePayment({ order: order(89000, 44500), payments: [pay('p1', 'succeeded', 44500)], recordedStatus: 'awaiting_payment' })!;
    expect(s.state).toBe('partial_payment');
    expect(s.label).toBe('Partially paid');
    expect(s.detail).toBe('$445.00 of $890.00 paid · $445.00 due');
    expect(s.tone).toBe('warning');
  });

  it('paid in full — several payments and a deposit sum to the total', () => {
    const s = summarizeCasePayment({
      order: order(89000, 0),
      payments: [pay('deposit', 'succeeded', 20000), pay('p2', 'succeeded', 39000), pay('p3', 'succeeded', 30000)],
      recordedStatus: 'paid_in_full',
    })!;
    expect(s.state).toBe('paid_in_full');
    expect(s.label).toBe('Paid in full');
    expect(s.paidCents).toBe(89000);
    expect(s.detail).toBe('$890.00 paid');
    expect(s.tone).toBe('success');
    expect(s.mismatch).toBeNull();
  });

  it('pending and failed payments never count as paid', () => {
    const s = summarizeCasePayment({
      order: order(89000, 89000),
      payments: [pay('p1', 'pending', 89000), pay('p2', 'failed', 89000), pay('p3', 'cancelled', 89000)],
      recordedStatus: 'awaiting_payment',
    })!;
    expect(s.state).toBe('awaiting_payment');
    expect(s.paidCents).toBe(0);
    expect(s.pendingCents).toBe(89000);
    expect(s.detail).toBe('$890.00 due · $890.00 pending');
  });

  it('a refunded payment no longer counts, and a case still marked paid is flagged', () => {
    const s = summarizeCasePayment({ order: order(89000, 89000), payments: [pay('p1', 'refunded', 89000)], recordedStatus: 'paid_in_full' })!;
    expect(s.state).toBe('awaiting_payment');
    expect(s.paidCents).toBe(0);
    expect(s.refundedCents).toBe(89000);
    expect(s.detail).toBe('$890.00 due · $890.00 refunded');
    expect(s.mismatch).toBe('marked_paid_with_balance');
  });

  it('a reversed (refunded) part-payment leaves the rest paid', () => {
    const s = summarizeCasePayment({
      order: order(89000, 39000),
      payments: [pay('p1', 'succeeded', 50000), pay('p2', 'refunded', 39000)],
      recordedStatus: 'awaiting_payment',
    })!;
    expect(s.state).toBe('partial_payment');
    expect(s.paidCents).toBe(50000);
    expect(s.detail).toBe('$500.00 of $890.00 paid · $390.00 due · $390.00 refunded');
  });

  it('the same payment record listed twice is counted once', () => {
    const s = summarizeCasePayment({ order: order(89000, 44500), payments: [pay('p1', 'succeeded', 44500), pay('p1', 'succeeded', 44500)], recordedStatus: 'awaiting_payment' })!;
    expect(s.paidCents).toBe(44500);
    expect(s.state).toBe('partial_payment');
  });

  it('the balance is the Case Order’s own — a write-off that clears it reads as paid', () => {
    const s = summarizeCasePayment({ order: order(89000, 0), payments: [pay('p1', 'succeeded', 80000)], recordedStatus: 'awaiting_payment' })!;
    expect(s.state).toBe('paid_in_full');
    expect(s.mismatch).toBe('paid_but_not_marked');
  });

  it('a write-off alone that reduces the balance reads as partly settled', () => {
    const s = summarizeCasePayment({ order: order(89000, 60000), payments: [], recordedStatus: 'awaiting_payment' })!;
    expect(s.state).toBe('partial_payment');
  });

  it('a negative or malformed amount never inflates the paid total', () => {
    const s = summarizeCasePayment({ order: order(89000, 89000), payments: [pay('p1', 'succeeded', -500), pay('p2', 'succeeded', Number.NaN)], recordedStatus: 'awaiting_payment' })!;
    expect(s.paidCents).toBe(0);
  });
});
