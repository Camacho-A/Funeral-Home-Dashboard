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

/**
 * MFA enrollment gate (2026-11). Whether this organization requires its
 * staff to use MFA, read from the organization's own server-side record.
 * Cached briefly per organization (it is read on every org-scoped request of
 * a not-yet-enrolled identity); turning the policy on takes effect within
 * ORGANIZATION_MFA_POLICY_TTL_MS. A failed read throws — the caller's request
 * fails rather than being let through.
 */
export const ORGANIZATION_MFA_POLICY_TTL_MS = 30_000;
const policyCache = new Map<string, { requireMfa: boolean; readAt: number }>();

export async function organizationRequiresMfa(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  const key = `${dataAdapterMode}:${organizationId}`;
  const cached = policyCache.get(key);
  if (dataAdapterMode !== 'mock' && cached && Date.now() - cached.readAt < ORGANIZATION_MFA_POLICY_TTL_MS) return cached.requireMfa;
  const requireMfa = (await getOrganization(organizationId, dataAdapterMode))?.requireMfa === true;
  policyCache.set(key, { requireMfa, readAt: Date.now() });
  return requireMfa;
}

/** Forgets cached policies — after a policy change in this process, and in tests. */
export function clearOrganizationMfaPolicyCache(): void {
  policyCache.clear();
}

/**
 * True when this identity may not act in this organization until it enrolls
 * in MFA: the organization requires MFA and the identity has not enrolled.
 * Per organization — an organization that does not require MFA is never
 * affected by another one that does.
 */
export async function mfaEnrollmentRequiredFor(
  identity: Pick<Identity, 'mfaEnabled'>,
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<boolean> {
  if (identity.mfaEnabled) return false;
  return organizationRequiresMfa(organizationId, dataAdapterMode);
}
