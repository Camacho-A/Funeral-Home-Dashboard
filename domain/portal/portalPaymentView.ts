import type { PaymentRecord } from '../../types/payment';
import { CASE_REFUND_KIND_LABEL, refundKindOf } from '../billing/caseRefunds';

/**
 * Phase 29 (Family Portal & External Collaboration). An explicit
 * allowlisting DTO — the family-facing shape of a `PaymentRecord`, gated
 * by `payment.read`. Never a raw `PaymentRecord`: excludes
 * `providerCheckoutId`/`idempotencyKey`/`providerPaymentId` (provider
 * correlation internals — refinement #10), `failureCode`/`failureMessage`
 * (operator-facing debugging detail, never shown to a family member),
 * `checkoutUrl` (an active-session detail returned directly by
 * `portalPaymentService.ts`'s checkout-initiation call, never echoed back
 * in history), `caseOrderId`/`organizationId`/`caseId` (redundant —
 * already scoped by the route), and `updatedAt` (internal bookkeeping).
 */
export type PortalPaymentView = {
  id: string;
  provider: string;
  status: string;
  amount: number;
  currency: string;
  purpose: string;
  cardBrand: string | null;
  cardLast4: string | null;
  receiptReference: string | null;
  createdAt: string;
  paidAt: string | null;
};

export function buildPortalPaymentView(payment: PaymentRecord): PortalPaymentView {
  // Case refunds (2026-11): a family reads "Refund (Family overpaid)", never
  // the stored purpose code.
  const refundKind = refundKindOf(payment);
  return {
    id: payment.id,
    provider: payment.provider,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    purpose: refundKind ? `Refund (${CASE_REFUND_KIND_LABEL[refundKind]})` : payment.purpose,
    cardBrand: payment.cardBrand,
    cardLast4: payment.cardLast4,
    receiptReference: payment.receiptReference,
    createdAt: payment.createdAt,
    paidAt: payment.paidAt,
  };
}
