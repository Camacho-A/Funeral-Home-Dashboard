import type { ActivityContext } from '../activityService';

/**
 * Phase 29 (Family Portal & External Collaboration). Every Family Portal
 * user's own action (accepting an invitation, logging in, viewing a
 * document, completing a signature, paying, sending a message) is
 * attributed the same way `services/signatureService.ts`'s
 * `signerActivityContext()` attributes an external signer's actions:
 * `actorIdentityId: null, isSystemGenerated: true` — a real person did
 * this, but they are not staff-`Identity`-space, so this is the one valid
 * combination `types/activityEvent.ts` allows. Real, queryable
 * attribution (which `PortalUser`, which `relationshipType`) is carried
 * in each `recordPortal*` helper's own `metadata` — never in
 * `actorIdentityId`, which stays Identity-space by this codebase's own
 * established convention.
 *
 * Distinct from staff-initiated portal actions (inviting, revoking
 * access) — those use the caller's own real `ActivityContext`, exactly
 * like every other staff-initiated action in this codebase. Reuses the
 * request's own `correlationId` rather than minting a new one, mirroring
 * `signerActivityContext()`'s own reasoning.
 */
export function portalActivityContext(organizationId: string, correlationId: string): ActivityContext {
  return { organizationId, actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId, isSystemGenerated: true };
}
