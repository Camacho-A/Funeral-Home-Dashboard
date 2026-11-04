import { describe, expect, it } from 'vitest';
import { computeCaseBalance, type CaseBalanceRecord } from './caseBalance';

const pay = (id: string, amount: number, status: CaseBalanceRecord['status'] = 'succeeded'): CaseBalanceRecord => ({ id, amount, status });

describe('computeCaseBalance', () => {
  it('a partly paid order owes the difference and has no overpayment', () => {
    expect(computeCaseBalance({ orderTotalCents: 189_500, payments: [pay('p1', 50_000)] })).toEqual({
      orderTotalCents: 189_500, paidCents: 50_000, writeOffCents: 0, balanceDueCents: 139_500, overpaymentCents: 0,
    });
  });

  it('paid exactly: nothing owed, no overpayment', () => {
    expect(computeCaseBalance({ orderTotalCents: 100_000, payments: [pay('p1', 60_000), pay('p2', 40_000)] })).toMatchObject({ balanceDueCents: 0, overpaymentCents: 0 });
  });

  it('an order reduced below what was paid shows the exact excess, never a negative balance', () => {
    expect(computeCaseBalance({ orderTotalCents: 150_000, payments: [pay('p1', 189_500)] })).toMatchObject({ balanceDueCents: 0, overpaymentCents: 39_500 });
  });

  it('refunded, pending, failed and cancelled payments never count; a duplicate record counts once', () => {
    const payments = [pay('p1', 100_000), pay('p1', 100_000), pay('p2', 50_000, 'refunded'), pay('p3', 70_000, 'pending'), pay('p4', 10_000, 'failed'), pay('p5', 5_000, 'cancelled')];
    expect(computeCaseBalance({ orderTotalCents: 90_000, payments })).toMatchObject({ paidCents: 100_000, balanceDueCents: 0, overpaymentCents: 10_000 });
  });

  it('a refund that brings payments back to the total clears the overpayment', () => {
    expect(computeCaseBalance({ orderTotalCents: 100_000, payments: [pay('p1', 100_000), pay('p2', 25_000, 'refunded')] })).toMatchObject({ overpaymentCents: 0, balanceDueCents: 0 });
  });

  it('a zero-total order: every succeeded payment is excess', () => {
    expect(computeCaseBalance({ orderTotalCents: 0, payments: [pay('p1', 12_000)] })).toMatchObject({ balanceDueCents: 0, overpaymentCents: 12_000 });
    expect(computeCaseBalance({ orderTotalCents: 0, payments: [] })).toMatchObject({ balanceDueCents: 0, overpaymentCents: 0 });
  });

  it('write-offs reduce what is owed but never create an overpayment on their own', () => {
    expect(computeCaseBalance({ orderTotalCents: 100_000, payments: [pay('p1', 70_000)], writeOffCents: 30_000 })).toMatchObject({ balanceDueCents: 0, overpaymentCents: 0 });
    expect(computeCaseBalance({ orderTotalCents: 100_000, payments: [], writeOffCents: 150_000 })).toMatchObject({ balanceDueCents: 0, overpaymentCents: 0 });
    expect(computeCaseBalance({ orderTotalCents: 100_000, payments: [pay('p1', 80_000)], writeOffCents: 30_000 })).toMatchObject({ balanceDueCents: 0, overpaymentCents: 10_000 });
  });

  it('ignores negative or non-numeric amounts', () => {
    expect(computeCaseBalance({ orderTotalCents: 10_000, payments: [pay('p1', -5_000), pay('p2', Number.NaN)] })).toMatchObject({ paidCents: 0, balanceDueCents: 10_000, overpaymentCents: 0 });
  });
});
