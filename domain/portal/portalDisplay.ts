import type { PortalInvitationStatus } from '@/types/portalInvitation';
import type { PortalAccessStatus } from '@/types/portalAccess';
import type { BadgeVariant } from '@/components/ui/Badge';

/**
 * Phase 29 (Family Portal & External Collaboration). Which
 * `PortalInvitationStatus`/`PortalAccessStatus` maps to which display
 * label/Badge variant — a domain decision, kept out of any component,
 * mirroring `domain/scheduling/appointmentDisplay.ts`'s exact shape.
 */
export const PORTAL_INVITATION_STATUS_LABEL: Record<PortalInvitationStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  accepted: 'Accepted',
  expired: 'Expired',
  revoked: 'Revoked',
};

export function portalInvitationStatusVariant(status: PortalInvitationStatus): BadgeVariant {
  if (status === 'accepted') return 'success';
  if (status === 'expired' || status === 'revoked') return 'danger';
  if (status === 'pending') return 'brand';
  return 'neutral'; // draft
}

export const PORTAL_ACCESS_STATUS_LABEL: Record<PortalAccessStatus, string> = {
  pending: 'Pending',
  active: 'Active',
  disabled: 'Disabled',
  revoked: 'Revoked',
  expired: 'Expired',
};

export function portalAccessStatusVariant(status: PortalAccessStatus): BadgeVariant {
  if (status === 'active') return 'success';
  if (status === 'revoked' || status === 'expired') return 'danger';
  if (status === 'pending') return 'brand';
  return 'neutral'; // disabled
}
