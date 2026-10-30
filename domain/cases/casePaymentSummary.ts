import type { PaymentStatus } from '../../types/case';
import type { PaymentRecordStatus } from '../../types/payment';
import { resolveReceiptPaymentStatus } from '../billing/receiptOfPayment';

/**
 * Payment status shown on the case (2026-10) — derived, never stored.
 *
 * The Case Information "Payment" control has always shown the stored
 * two-value `Case.paymentStatus` (it drives the "Payment collected"
 * checklist item and stage reconciliation, so it is kept exactly as is).
 * This summary sits beside it and follows the money instead, the same
 * way the Receipt of Payment does (resolveReceiptPaymentStatus):
 *
 *   - the balance is the Case Order's own server-computed `balanceDue`
 *     (total minus succeeded payments and write-offs — never recomputed
 *     here, so there is one balance in SOLIS, not two);
 *   - "paid" counts only `succeeded` payment records. Pending, failed,
 *     cancelled and refunded records never count, and a record seen twice
 *     (same id) is counted once;
 *   - when the stored status says "Paid in full" but the records still
 *     show a balance (a refund, or a status set by hand), the summary says
 *     so instead of silently agreeing with either side.
 */

export type CasePaymentState = 'paid_in_full' | 'partial_payment' | 'awaiting_payment';

export type CasePaymentSummary = {
  state: CasePaymentState;
  /** Short status, e.g. "Paid in full", "Partially paid". */
  label: string;
  /** One line of amounts, e.g. "$445.00 of $890.00 paid · $445.00 due". */
  detail: string;
  tone: 'success' | 'warning' | 'neutral';
  totalCents: number;
  paidCents: number;
  balanceDueCents: number;
  pendingCents: number;
  refundedCents: number;
  /** The stored "Payment" value disagrees with the payment records. */
  mismatch: 'marked_paid_with_balance' | 'paid_but_not_marked' | null;
};

export type PaymentSummaryRecord = { id: string; status: PaymentRecordStatus; amount: number };

const LABEL: Record<CasePaymentState, string> = {
  paid_in_full: 'Paid in full',
  partial_payment: 'Partially paid',
  awaiting_payment: 'Awaiting payment',
};

function dollars(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function sumByStatus(records: readonly PaymentSummaryRecord[], status: PaymentRecordStatus): number {
  return records.filter((r) => r.status === status).reduce((sum, r) => sum + (Number.isFinite(r.amount) && r.amount > 0 ? r.amount : 0), 0);
}

/**
 * Null when there is no Case Order (or a $0 one) — there is nothing to
 * derive from, and the stored value is shown on its own exactly as before.
 */
export function summarizeCasePayment(params: {
  order: { total: number; balanceDue: number } | null | undefined;
  payments: readonly PaymentSummaryRecord[] | null | undefined;
  recordedStatus: PaymentStatus;
}): CasePaymentSummary | null {
  const { order, recordedStatus } = params;
  if (!order || !(order.total > 0)) return null;

  const seen = new Set<string>();
  const records = (params.payments ?? []).filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));

  const totalCents = order.total;
  const balanceDueCents = Math.max(order.balanceDue, 0);
  const paidCents = sumByStatus(records, 'succeeded');
  const pendingCents = sumByStatus(records, 'pending');
  const refundedCents = sumByStatus(records, 'refunded');

  const receipt = resolveReceiptPaymentStatus({ balanceDueCents, paidCents });
  // A balance reduced by a write-off alone (no payment) is still partly settled.
  const state: CasePaymentState =
    receipt === 'paid_in_full' ? 'paid_in_full' : receipt === 'partial_payment' || balanceDueCents < totalCents ? 'partial_payment' : 'awaiting_payment';

  const parts: string[] = [];
  if (state === 'paid_in_full') parts.push(`${dollars(totalCents)} paid`);
  else if (state === 'partial_payment') parts.push(`${dollars(totalCents - balanceDueCents)} of ${dollars(totalCents)} paid`, `${dollars(balanceDueCents)} due`);
  else parts.push(`${dollars(balanceDueCents)} due`);
  if (pendingCents > 0) parts.push(`${dollars(pendingCents)} pending`);
  if (refundedCents > 0) parts.push(`${dollars(refundedCents)} refunded`);

  const mismatch =
    recordedStatus === 'paid_in_full' && state !== 'paid_in_full'
      ? 'marked_paid_with_balance'
      : recordedStatus !== 'paid_in_full' && state === 'paid_in_full'
        ? 'paid_but_not_marked'
        : null;

  return {
    state,
    label: LABEL[state],
    detail: parts.join(' · '),
    tone: state === 'paid_in_full' ? 'success' : state === 'partial_payment' ? 'warning' : 'neutral',
    totalCents,
    paidCents,
    balanceDueCents,
    pendingCents,
    refundedCents,
    mismatch,
  };
}
