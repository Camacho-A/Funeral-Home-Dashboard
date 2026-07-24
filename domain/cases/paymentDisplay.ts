import type { PaymentRecordStatus } from '../../types/payment';
import type { BadgeVariant } from '../../components/ui/Badge';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Which PaymentRecord
 * status maps to which Badge variant/label — a domain decision, kept out
 * of components/case/PaymentCard.tsx per Badge's own convention (see
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
