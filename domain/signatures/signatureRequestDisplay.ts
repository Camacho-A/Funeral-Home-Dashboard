import type { SignatureRequestStatus } from '@/types/signatureRequest';
import type { BadgeVariant } from '@/components/ui/Badge';

/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). Which
 * `SignatureRequestStatus` maps to which display label/Badge variant — a
 * domain decision, kept out of `components/case/SignatureStatusPanel.tsx`
 * per `Badge`'s own convention, mirroring
 * `domain/documents/caseDocumentDisplay.ts`'s exact shape.
 */
export const SIGNATURE_REQUEST_STATUS_LABEL: Record<SignatureRequestStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  viewed: 'Viewed',
  signed: 'Signed',
  declined: 'Declined',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

export function signatureRequestStatusVariant(status: SignatureRequestStatus): BadgeVariant {
  if (status === 'signed') return 'success';
  if (status === 'declined' || status === 'expired') return 'danger';
  if (status === 'pending' || status === 'viewed') return 'brand';
  return 'neutral'; // draft, cancelled
}

export const ACTIVE_SIGNATURE_REQUEST_STATUSES: readonly SignatureRequestStatus[] = ['draft', 'pending', 'viewed'];
