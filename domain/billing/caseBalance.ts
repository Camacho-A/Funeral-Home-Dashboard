import type { PaymentRecordStatus } from '../../types/payment';
import { chargeReductionCents, netPaidCents } from './caseRefunds';

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
 *     write-off can never create an overpayment on its own;
 *   - case refunds (2026-11, domain/billing/caseRefunds.ts): a refund staff
 *     gave back comes off what was paid, and one given because a service
 *     was removed or a price lowered also comes off what is owed.
 *
 * Pure and read-only: it never refunds, credits or changes a record.
 */

export type CaseBalanceRecord = { id: string; status: PaymentRecordStatus; amount: number; purpose?: string | null };

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
  const records = params.payments.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  const paidCents = netPaidCents(records);

  const owedAfterWriteOffs = Math.max(orderTotalCents - writeOffCents - chargeReductionCents(records), 0);
  return {
    orderTotalCents,
    paidCents,
    writeOffCents,
    balanceDueCents: Math.max(owedAfterWriteOffs - paidCents, 0),
    overpaymentCents: Math.max(paidCents - owedAfterWriteOffs, 0),
  };
}
