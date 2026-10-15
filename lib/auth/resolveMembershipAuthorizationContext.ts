import type { IdentitySession } from '../../types/identitySession';
import type { AuthorizationContext } from '../../types/authorization';
import type { DataAdapterMode } from '../env';
import { listMembershipsForIdentity, isActiveMembership } from '../../services/membershipService';
import { setSessionOrganization } from '../../services/sessionService';
import { isOrganizationAllowedInDeployment } from './deploymentOrganizations';

/**
 * Phase 21 (Identity, Authentication & Session Management). The
 * identity-mode sibling of lib/auth/authorize.ts's resolveAuthorizationContext
 * — same contract (never trust a browser-supplied organizationId; auto-select
 * when there's exactly one active membership; require explicit selection
 * otherwise), but reading types/membership.ts's Membership model instead of
 * the mock-fixture-based OrganizationMembership the other resolver uses.
 *
 * The "requested organization" for an identity-mode session is never a
 * per-request query param or client claim — it's the IdentitySession
 * registry row's own `organizationId` (see types/identitySession.ts),
 * itself only ever set by this module or the /switch-organization route
 * after independently confirming an active membership exists. A caller
 * can still pass `requestedOrganizationId` explicitly (used by
 * /switch-organization itself, before it calls setSessionOrganization).
 */
/**
 * Deployment organization restrictions (2026-10): only memberships whose
 * organization THIS deployment serves (lib/auth/deploymentOrganizations.ts)
 * are ever considered — for an explicit request, for the session's stored
 * organization, and for implicit single-membership auto-selection alike.
 *
 * `organization_not_allowed` is returned (never a silent switch to some
 * other organization) when the explicitly requested organization, or the
 * session's previously-selected one, is outside this deployment. Signing
 * in again (a fresh session has no stored organization) or an explicit
 * /api/auth/switch-organization to an allowed organization recovers.
 */
export type MembershipAuthorizeResult =
  | { granted: true; context: AuthorizationContext }
  | {
      granted: false;
      reason: 'no_active_membership' | 'organization_mismatch' | 'selection_required' | 'organization_not_allowed';
    };

export async function resolveMembershipAuthorizationContext(
  identitySession: IdentitySession,
  dataAdapterMode: DataAdapterMode,
  requestedOrganizationId?: string,
): Promise<MembershipAuthorizeResult> {
  if (requestedOrganizationId != null && !isOrganizationAllowedInDeployment(requestedOrganizationId)) {
    return { granted: false, reason: 'organization_not_allowed' };
  }
  if (identitySession.organizationId != null && requestedOrganizationId == null && !isOrganizationAllowedInDeployment(identitySession.organizationId)) {
    return { granted: false, reason: 'organization_not_allowed' };
  }

  const memberships = (await listMembershipsForIdentity(identitySession.identityId, dataAdapterMode))
    .filter(isActiveMembership)
    .filter((membership) => isOrganizationAllowedInDeployment(membership.organizationId));

  if (memberships.length === 0) {
    return { granted: false, reason: 'no_active_membership' };
  }

  if (requestedOrganizationId != null) {
    const membership = memberships.find((m) => m.organizationId === requestedOrganizationId);
    if (!membership) {
      return { granted: false, reason: 'organization_mismatch' };
    }
    return {
      granted: true,
      context: { userId: identitySession.identityId, organizationId: membership.organizationId, role: membership.role },
    };
  }

  if (identitySession.organizationId != null) {
    const membership = memberships.find((m) => m.organizationId === identitySession.organizationId);
    if (membership) {
      return {
        granted: true,
        context: { userId: identitySession.identityId, organizationId: membership.organizationId, role: membership.role },
      };
    }
    // The session's previously-selected organization is no longer a valid
    // membership (e.g. removed since) — fall through and reselect below
    // rather than granting access to a stale organizationId.
  }

  if (memberships.length === 1) {
    const membership = memberships[0];
    await setSessionOrganization(identitySession.id, membership.organizationId, dataAdapterMode);
    return {
      granted: true,
      context: { userId: identitySession.identityId, organizationId: membership.organizationId, role: membership.role },
    };
  }

  return { granted: false, reason: 'selection_required' };
}
