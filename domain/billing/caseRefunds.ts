import type { PaymentRecordStatus } from '../../types/payment';

/**
 * Case refunds (2026-11) — money handed back to a family after it was
 * paid, recorded by staff. Nothing is charged or reversed at a card
 * processor here: like Record Payment, this records a refund staff have
 * already given (cash, check, card refund at the terminal, …).
 *
 * A refund is its own `paymentRecords` row with status `'refund_issued'`
 * — never an edit of the payment it pays back, so every payment stays on
 * the receipt exactly as it was received, and the refund appears beside
 * it. Because every existing "money in" path reads `'succeeded'` only
 * (deposits, reports, the family portal), a refund row can never be
 * mistaken for a payment there.
 *
 * Staff choose why each time, because the two reasons move the numbers
 * differently:
 *
 *   - `overpaid` — the family paid more than the charges. The charges
 *     stay; only the amount paid goes down. Capped at what was overpaid,
 *     so a refund can never reopen a balance.
 *   - `charges_reduced` — a service was removed or a price lowered. The
 *     total charges go down by the refund as well, so the balance stays
 *     where it was. Capped at the amount paid.
 */
export const REFUND_STATUS: PaymentRecordStatus = 'refund_issued';

export const CASE_REFUND_KINDS = ['overpaid', 'charges_reduced'] as const;
export type CaseRefundKind = (typeof CASE_REFUND_KINDS)[number];

/** Stored in `PaymentRecord.purpose` — the existing free-text field, so
    no new Wix field is needed. */
export const CASE_REFUND_PURPOSE: Record<CaseRefundKind, string> = {
  overpaid: 'refund_overpaid',
  charges_reduced: 'refund_charges_reduced',
};

export const CASE_REFUND_KIND_LABEL: Record<CaseRefundKind, string> = {
  overpaid: 'Family overpaid',
  charges_reduced: 'Service removed or price lowered',
};

export const CASE_REFUND_KIND_HINT: Record<CaseRefundKind, string> = {
  overpaid: 'The charges stay the same. Only the amount paid goes down.',
  charges_reduced: 'The total charges go down by the refund too, so the balance does not change.',
};

export function isCaseRefundKind(value: unknown): value is CaseRefundKind {
  return typeof value === 'string' && (CASE_REFUND_KINDS as readonly string[]).includes(value);
}

export type RefundLedgerRecord = { id?: string; status: PaymentRecordStatus; amount: number; purpose?: string | null };

function positive(amount: number): number {
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export function isRefundRecord(record: RefundLedgerRecord): boolean {
  return record.status === REFUND_STATUS;
}

export function refundKindOf(record: RefundLedgerRecord): CaseRefundKind | null {
  if (!isRefundRecord(record)) return null;
  return record.purpose === CASE_REFUND_PURPOSE.charges_reduced ? 'charges_reduced' : 'overpaid';
}

/** Money received: every succeeded payment. */
export function receivedCents(records: readonly RefundLedgerRecord[]): number {
  return records.filter((r) => r.status === 'succeeded').reduce((sum, r) => sum + positive(r.amount), 0);
}

/** Money handed back: every refund row. */
export function refundedCents(records: readonly RefundLedgerRecord[]): number {
  return records.filter(isRefundRecord).reduce((sum, r) => sum + positive(r.amount), 0);
}

/** Received minus refunded — what the family has actually paid. */
export function netPaidCents(records: readonly RefundLedgerRecord[]): number {
  return Math.max(receivedCents(records) - refundedCents(records), 0);
}

/** Refunds given because the charges went down — they lower the amount owed. */
export function chargeReductionCents(records: readonly RefundLedgerRecord[]): number {
  return records.filter((r) => refundKindOf(r) === 'charges_reduced').reduce((sum, r) => sum + positive(r.amount), 0);
}

/**
 * The most each kind of refund may be, given the case's figures today.
 *
 * `satisfiedCents` is everything already counted against the order: net
 * paid, write-offs, and earlier charge reductions — the same figure the
 * balance is computed from (services/pricingService.ts).
 */
export function maxRefundCents(params: {
  kind: CaseRefundKind;
  orderTotalCents: number;
  netPaidCents: number;
  satisfiedCents: number;
}): number {
  const netPaid = Math.max(params.netPaidCents, 0);
  if (params.kind === 'charges_reduced') return netPaid;
  const overpaid = Math.max(params.satisfiedCents - params.orderTotalCents, 0);
  return Math.min(overpaid, netPaid);
}

export function refundTooLargeMessage(kind: CaseRefundKind, maxCents: number): string {
  const max = `$${(maxCents / 100).toFixed(2)}`;
  if (kind === 'overpaid') {
    return maxCents <= 0
      ? "The family has not paid more than the charges. If a service was removed or a price lowered, choose 'Service removed or price lowered'."
      : `The family overpaid by ${max}, so that is the most this refund can be. If a service was removed or a price lowered, choose 'Service removed or price lowered'.`;
  }
  return maxCents <= 0 ? 'Nothing has been paid on this case, so there is nothing to refund.' : `The most that can be refunded is ${max} — the amount paid so far.`;
}
