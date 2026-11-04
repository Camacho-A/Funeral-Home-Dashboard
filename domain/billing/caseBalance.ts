import type { PaymentRecordStatus } from '../../types/payment';

/**
 * Case balance and overpayment (2026-11). When an order is reduced below
 * what the family has already paid, the Case Order's `balanceDue` stops at
 * $0 (domain/pricing/calculateOrder.ts calculateBalance) — correct as an
 * amount owed, but silent about the money received beyond the total. This
 * computes that excess so staff are told about it.
 *
 * Counting follows the existing balance exactly:
 *   - paid = `succeeded` payment records only (pending, failed, cancelled
 *     and refunded never count — a refund flips its record to `refunded`,
 *     so "net of refunds" needs no separate subtraction); a record seen
 *     twice (same id) counts once;
 *   - write-offs reduce what is owed, but are never money received, so a
 *     write-off can never create an overpayment on its own.
 *
 * Pure and read-only: it never refunds, credits or changes a record.
 */

export type CaseBalanceRecord = { id: string; status: PaymentRecordStatus; amount: number };

export type CaseBalance = {
  orderTotalCents: number;
  /** Succeeded payments, net of refunds. */
  paidCents: number;
  writeOffCents: number;
  /** What is still owed — never negative. */
  balanceDueCents: number;
  /** Money received beyond what is owed — 0 when there is none. */
  overpaymentCents: number;
};

const positive = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

export function computeCaseBalance(params: {
  orderTotalCents: number;
  payments: readonly CaseBalanceRecord[];
  writeOffCents?: number;
}): CaseBalance {
  const orderTotalCents = positive(params.orderTotalCents);
  const writeOffCents = positive(params.writeOffCents ?? 0);
  const seen = new Set<string>();
  const paidCents = params.payments
    .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
    .filter((p) => p.status === 'succeeded')
    .reduce((sum, p) => sum + positive(p.amount), 0);

  const owedAfterWriteOffs = Math.max(orderTotalCents - writeOffCents, 0);
  return {
    orderTotalCents,
    paidCents,
    writeOffCents,
    balanceDueCents: Math.max(owedAfterWriteOffs - paidCents, 0),
    overpaymentCents: Math.max(paidCents - owedAfterWriteOffs, 0),
  };
}
