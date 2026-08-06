import type { PortalRelationshipType } from '../domain/portal/portalRelationshipRegistry';

/**
 * Phase 29 (Family Portal & External Collaboration). The *grant* — plays
 * `Membership`'s exact structural role, but is scoped to one **case**, not
 * one **organization**, and carries a `relationshipType` instead of an
 * RBAC role. See `types/portalInvitation.ts`'s own header comment for why
 * this is a separate entity from the invitation that produces it.
 *
 * **Created at invitation time, not acceptance time** — `status:'pending'`
 * from the moment staff sends the invitation, so the case and
 * relationship type this grant will confer are fixed from the start.
 * Accepting the linked `PortalInvitation` only ever **activates** this
 * row (`pending -> active`); it can never expand what the row already
 * says. Every status other than `active` fails closed — checked live, on
 * every request, never cached (see `lib/auth/requireFamilyAccess.ts`).
 */
export type PortalAccessStatus = 'pending' | 'active' | 'disabled' | 'revoked' | 'expired';

export type PortalAccess = {
  id: string;
  /** Null until the linked `PortalInvitation` is accepted. */
  portalUserId: string | null;
  organizationId: string;
  caseId: string;
  relationshipType: PortalRelationshipType;
  status: PortalAccessStatus;
  grantedFromInvitationId: string;
  createdAt: string;
  updatedAt: string;
};

export function isTerminalPortalAccessStatus(status: PortalAccessStatus): boolean {
  return status === 'revoked' || status === 'expired';
}
