import { describe, expect, it } from 'vitest';
import {
  CASE_REFUND_PURPOSE,
  chargeReductionCents,
  maxRefundCents,
  netPaidCents,
  refundKindOf,
  refundedCents,
  refundTooLargeMessage,
  type RefundLedgerRecord,
} from './caseRefunds';

const paid = (amount: number): RefundLedgerRecord => ({ status: 'succeeded', amount });
const refund = (amount: number, kind: 'overpaid' | 'charges_reduced'): RefundLedgerRecord => ({ status: 'refund_issued', amount, purpose: CASE_REFUND_PURPOSE[kind] });

describe('case refunds — the figures', () => {
  it('net paid is received minus refunded; pending, failed and processor-refunded records never count', () => {
    const records = [paid(60_000), paid(50_000), refund(10_000, 'overpaid'), { status: 'pending', amount: 9_999 } as RefundLedgerRecord, { status: 'refunded', amount: 7_000 } as RefundLedgerRecord];
    expect(refundedCents(records)).toBe(10_000);
    expect(netPaidCents(records)).toBe(100_000);
  });

  it('only "service removed or price lowered" refunds lower the charges', () => {
    const records = [paid(100_000), refund(10_000, 'overpaid'), refund(25_000, 'charges_reduced')];
    expect(chargeReductionCents(records)).toBe(25_000);
    expect(refundKindOf(records[1])).toBe('overpaid');
    expect(refundKindOf(records[2])).toBe('charges_reduced');
    expect(refundKindOf(records[0])).toBeNull();
  });
});

describe('case refunds — the most that can be refunded', () => {
  it('family overpaid: only the overpaid amount', () => {
    expect(maxRefundCents({ kind: 'overpaid', orderTotalCents: 100_000, netPaidCents: 110_000, satisfiedCents: 110_000 })).toBe(10_000);
    expect(maxRefundCents({ kind: 'overpaid', orderTotalCents: 100_000, netPaidCents: 100_000, satisfiedCents: 100_000 })).toBe(0);
    // A write-off that already covered part of the bill counts toward the overpayment, but never more than was paid.
    expect(maxRefundCents({ kind: 'overpaid', orderTotalCents: 100_000, netPaidCents: 5_000, satisfiedCents: 120_000 })).toBe(5_000);
  });

  it('service removed: anything up to what was paid', () => {
    expect(maxRefundCents({ kind: 'charges_reduced', orderTotalCents: 100_000, netPaidCents: 60_000, satisfiedCents: 60_000 })).toBe(60_000);
  });

  it('the messages say why, in plain words', () => {
    expect(refundTooLargeMessage('overpaid', 0)).toContain('has not paid more than the charges');
    expect(refundTooLargeMessage('overpaid', 10_000)).toContain('overpaid by $100.00');
    expect(refundTooLargeMessage('charges_reduced', 0)).toBe('Nothing has been paid on this case, so there is nothing to refund.');
    expect(refundTooLargeMessage('charges_reduced', 60_000)).toContain('$600.00');
  });
});
