import type { DataAdapterMode } from '../lib/env';
import type { Identity } from '../types/identity';
import { listMembershipsForIdentity, isActiveMembership } from './membershipService';
import { getOrganization } from './organizationProvisioningService';

/**
 * Phase 40 (MFA & Account Security). Org-level require-MFA policy resolution.
 * Kept separate from RBAC — MFA is an authentication-strength policy, not an
 * authorization grant (approved requirement 9). This module never checks
 * permissions and RBAC never checks MFA state.
 */

/**
 * True when this staff identity must enroll in MFA before proceeding: they are
 * not yet MFA-enabled AND at least one of their active-membership
 * organizations has `requireMfa`. A member is routed to enrollment (never
 * hard-locked). An identity that is already MFA-enabled always returns false.
 * Family Portal users are a wholly separate population and are never evaluated
 * here.
 */
export async function identityMustEnrollMfa(identity: Identity, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  if (identity.mfaEnabled) return false;
  const memberships = (await listMembershipsForIdentity(identity.id, dataAdapterMode)).filter(isActiveMembership);
  for (const membership of memberships) {
    const org = await getOrganization(membership.organizationId, dataAdapterMode);
    if (org?.requireMfa === true) return true;
  }
  return false;
}
