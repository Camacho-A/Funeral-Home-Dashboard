import type { AuthSession } from '../../types/auth';
import type { AuthorizationContext } from '../../types/authorization';
import type { OrganizationMembership } from '../../types/organization';
import { mockMembershipFixtures, mockOrganizationFixtures } from '../../services/__mocks__/authFixtures';
import { isAdminTier } from '../../services/authorizationPolicyService';

/**
 * Phase 13 (Authentication & Organizations). Looks up a user's ACTIVE,
 * usable memberships. Reads mock fixtures regardless of DATA_ADAPTER — no
 * real Wix membership data collection exists yet (creating one is
 * explicitly out of this phase's scope; see docs/AUTHENTICATION.md's known
 * limitations). A membership only counts if *both* the membership row and
 * its organization are active — a suspended organization must reject
 * access even for an otherwise-valid member.
 */
function findActiveMemberships(userId: string): OrganizationMembership[] {
  return mockMembershipFixtures.filter((membership) => {
    if (membership.userId !== userId || !membership.isActive) return false;
    const organization = mockOrganizationFixtures.find((org) => org.id === membership.organizationId);
    return organization?.isActive === true;
  });
}

export type AuthorizeResult =
  | { granted: true; context: AuthorizationContext }
  | {
      granted: false;
      reason: 'no_active_membership' | 'organization_mismatch' | 'selection_required';
    };

/**
 * The one function every protected operation should route through before
 * trusting an organizationId. `requestedOrganizationId`, if given, is
 * treated as an *untrusted claim* — possibly supplied by the browser —
 * and is only ever honored if it matches one of the session user's own
 * active memberships. This is the concrete mechanism behind "never trust
 * organizationId supplied by the browser as proof of authorization": a
 * request claiming any organizationId the user doesn't actually belong to
 * is rejected here, before it ever reaches a service call.
 *
 * With no organizationId requested: auto-selects the user's one active
 * membership when there's exactly one (today's default case — the mock
 * user has exactly one). With more than one and no selection, this
 * returns `selection_required` rather than guessing — the
 * "architecture-ready active-organization selection mechanism" the phase
 * asks for, not a full switcher UI (see docs/AUTHENTICATION.md).
 */
export function resolveAuthorizationContext(
  session: AuthSession,
  requestedOrganizationId?: string,
): AuthorizeResult {
  const memberships = findActiveMemberships(session.user.id);

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
      context: { userId: session.user.id, organizationId: membership.organizationId, role: membership.role },
    };
  }

  if (memberships.length === 1) {
    const membership = memberships[0];
    return {
      granted: true,
      context: { userId: session.user.id, organizationId: membership.organizationId, role: membership.role },
    };
  }

  return { granted: false, reason: 'selection_required' };
}

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Whether a user
 * already holds an owner/administrator-tier active membership in one
 * specific organization — used by
 * `lib/auth/requireOnboardingAccess.ts` to let an organization's own
 * administrator resume its onboarding session without needing platform-
 * administrator status. Reuses the same `findActiveMemberships` lookup
 * every other authorization decision in this file goes through — never a
 * second, divergent membership query.
 *
 * Phase 22 (Role-Based Access Control) migration: no longer compares
 * `membership.role` against a literal role name — delegates to
 * `authorizationPolicyService.isAdminTier`, which resolves the role's
 * actual permission set (`organization.manage`) instead. Behavior is
 * unchanged: `domain/rbac/legacyRoleAliases.ts` maps `owner`/`administrator`
 * onto the same `administrator` default role, the only one granted
 * `organization.manage`, so the exact same two role values still (and
 * only) satisfy this check. Always resolved against `dataAdapterMode:
 * 'mock'` — this function reads mock membership fixtures regardless of
 * `DATA_ADAPTER` (see `findActiveMemberships`'s own comment), so its role
 * resolution stays consistent with that same mock-only data source.
 */
export async function hasAdminTierMembership(userId: string, organizationId: string): Promise<boolean> {
  const memberships = findActiveMemberships(userId).filter((membership) => membership.organizationId === organizationId);
  const results = await Promise.all(
    memberships.map((membership) => isAdminTier({ identityId: userId, organizationId, roleKey: membership.role }, 'mock')),
  );
  return results.some(Boolean);
}
