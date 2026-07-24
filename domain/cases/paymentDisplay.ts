import type { PaymentRecordStatus } from '../../types/payment';
import type { BadgeVariant } from '../../components/ui/Badge';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Which PaymentRecord
 * status maps to which Badge variant/label — a domain decision, kept out
 * of components/case/CaseOrderCard.tsx per Badge's own convention (see
 * components/ui/Badge.tsx's comment) that a UI primitive never decides
 * what a business condition means.
 */
export const PAYMENT_RECORD_STATUS_LABEL: Record<PaymentRecordStatus, string> = {
  pending: 'Pending',
  succeeded: 'Paid',
  failed: 'Failed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export function paymentRecordStatusVariant(status: PaymentRecordStatus): BadgeVariant {
  if (status === 'succeeded') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'pending') return 'brand';
  return 'neutral'; // cancelled, refunded
}

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). A CaseOrder's
 * own balance-based status, distinct from any individual PaymentRecord's
 * status above — a case can have several payment attempts (some failed,
 * one succeeded) while its order itself is simply "paid in full" or
 * "balance due" depending on the one number that matters:
 * CaseOrder.balanceDue.
 */
export function caseOrderBalanceStatusLabel(balanceDue: number): string {
  return balanceDue <= 0 ? 'Paid in full' : 'Balance due';
}

export function caseOrderBalanceStatusVariant(balanceDue: number): BadgeVariant {
  return balanceDue <= 0 ? 'success' : 'brand';
}
