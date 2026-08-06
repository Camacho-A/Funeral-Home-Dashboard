import type { PortalInvitation, PortalInvitationStatus } from '../types/portalInvitation';
import { isValidPortalRelationshipType } from '../domain/portal/portalRelationshipRegistry';

/**
 * Phase 29 (Family Portal & External Collaboration). The one place a raw
 * `portalInvitations` Wix item is ever touched. `tokenHash` mirrors
 * `lib/wixSignatureRequestMapper.ts`'s own convention — the raw token is
 * never a field here at all.
 */
export type WixPortalInvitationItem = {
  beaconPortalInvitationId?: unknown;
  organizationId?: unknown;
  caseId?: unknown;
  email?: unknown;
  displayName?: unknown;
  relationshipType?: unknown;
  status?: unknown;
  tokenHash?: unknown;
  expiresAt?: unknown;
  invitedByStaffIdentityId?: unknown;
  linkedPortalAccessId?: unknown;
  acceptedAt?: unknown;
  revokedAt?: unknown;
  revokedByStaffIdentityId?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const VALID_STATUSES: readonly PortalInvitationStatus[] = ['draft', 'pending', 'accepted', 'expired', 'revoked'];

function isValidStatus(value: unknown): value is PortalInvitationStatus {
  return typeof value === 'string' && (VALID_STATUSES as readonly string[]).includes(value);
}

export function mapWixPortalInvitationItem(item: WixPortalInvitationItem | undefined): PortalInvitation | null {
  if (
    !item ||
    typeof item.beaconPortalInvitationId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.caseId !== 'string' ||
    typeof item.email !== 'string' ||
    typeof item.displayName !== 'string' ||
    !isValidPortalRelationshipType(item.relationshipType) ||
    !isValidStatus(item.status) ||
    typeof item.tokenHash !== 'string' ||
    typeof item.expiresAt !== 'string' ||
    typeof item.invitedByStaffIdentityId !== 'string' ||
    typeof item.linkedPortalAccessId !== 'string' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconPortalInvitationId,
    organizationId: item.organizationId,
    caseId: item.caseId,
    email: item.email,
    displayName: item.displayName,
    relationshipType: item.relationshipType,
    status: item.status,
    tokenHash: item.tokenHash,
    expiresAt: item.expiresAt,
    invitedByStaffIdentityId: item.invitedByStaffIdentityId,
    linkedPortalAccessId: item.linkedPortalAccessId,
    acceptedAt: typeof item.acceptedAt === 'string' ? item.acceptedAt : null,
    revokedAt: typeof item.revokedAt === 'string' ? item.revokedAt : null,
    revokedByStaffIdentityId: typeof item.revokedByStaffIdentityId === 'string' ? item.revokedByStaffIdentityId : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixPortalInvitationData(invitation: PortalInvitation): WixPortalInvitationItem {
  return {
    beaconPortalInvitationId: invitation.id,
    organizationId: invitation.organizationId,
    caseId: invitation.caseId,
    email: invitation.email,
    displayName: invitation.displayName,
    relationshipType: invitation.relationshipType,
    status: invitation.status,
    tokenHash: invitation.tokenHash,
    expiresAt: invitation.expiresAt,
    invitedByStaffIdentityId: invitation.invitedByStaffIdentityId,
    linkedPortalAccessId: invitation.linkedPortalAccessId,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
    revokedByStaffIdentityId: invitation.revokedByStaffIdentityId,
    createdAt: invitation.createdAt,
    updatedAt: invitation.updatedAt,
  };
}

/** Merges a partial patch onto the existing full Wix item — the only
    fields ever updated after creation are `status`, `acceptedAt`,
    `revokedAt`, `revokedByStaffIdentityId`, and `updatedAt`. */
export function applyPortalInvitationUpdateToWixData(
  existing: WixPortalInvitationItem,
  patch: Partial<PortalInvitation>,
): WixPortalInvitationItem {
  const next: WixPortalInvitationItem = { ...existing };
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.acceptedAt !== undefined) next.acceptedAt = patch.acceptedAt;
  if (patch.revokedAt !== undefined) next.revokedAt = patch.revokedAt;
  if (patch.revokedByStaffIdentityId !== undefined) next.revokedByStaffIdentityId = patch.revokedByStaffIdentityId;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
