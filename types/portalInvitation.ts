import type { PortalRelationshipType } from '../domain/portal/portalRelationshipRegistry';

/**
 * Phase 29 (Family Portal & External Collaboration). The *offer* — kept
 * deliberately separate from `PortalAccess` (the *grant* it produces),
 * mirroring the same separation-of-concerns Phase 28 established for
 * `Notification`/`Delivery`: this row answers "did someone accept an
 * invitation," `PortalAccess` answers "which case and capabilities can
 * they use." Accepting an invitation only ever activates its already-fixed
 * `linkedPortalAccessId` row — it can never create broader access than
 * that grant already specifies.
 *
 * `tokenHash` mirrors `SignatureRequest.tokenHash`'s own convention
 * exactly (SHA-256 hex via `lib/identity/tokens.ts`, never the raw token
 * persisted anywhere). Single-use in effect: once `status` leaves
 * `'pending'`, no further acceptance attempt can succeed — no separate
 * "used" flag is needed.
 */
export type PortalInvitationStatus = 'draft' | 'pending' | 'accepted' | 'expired' | 'revoked';

export type PortalInvitation = {
  id: string;
  organizationId: string;
  caseId: string;
  email: string;
  displayName: string;
  relationshipType: PortalRelationshipType;
  status: PortalInvitationStatus;
  tokenHash: string;
  expiresAt: string;
  /** A staff `Identity.id` — staff attribution is entirely unaffected by
      this phase's `PortalUser`/`Identity` separation. */
  invitedByStaffIdentityId: string;
  linkedPortalAccessId: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  revokedByStaffIdentityId: string | null;
  createdAt: string;
  updatedAt: string;
};

export function isTerminalPortalInvitationStatus(status: PortalInvitationStatus): boolean {
  return status === 'accepted' || status === 'expired' || status === 'revoked';
}
