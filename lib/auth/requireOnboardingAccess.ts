import { NextResponse } from 'next/server';
import type { AuthSession } from '../../types/auth';
import type { OnboardingSession } from '../../types/onboarding';
import { getSession } from './session';
import { isPlatformAdminUser } from './platformAdmin';
import { hasAdminTierMembership, isNonIdentityAuthorizationPermitted } from './authorize';
import { isOrganizationAllowedInDeployment } from './deploymentOrganizations';
import { getDataAdapterMode } from '../env';
import { getMembership, isActiveMembership } from '../../services/membershipService';
import { isAdminTier } from '../../services/authorizationPolicyService';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Authorization
 * for onboarding routes — a genuinely different shape from every other
 * Route Handler's `requireAuthorizedOrganization`, because onboarding
 * spans a period (before an administrator membership exists) where no
 * ordinary organization-scoped authorization check can succeed at all.
 *
 * Critically: **no onboarding route (other than `/start`) ever accepts an
 * `organizationId` from the client.** Every other route takes an
 * `onboardingSessionId` instead, looks up the `OnboardingSession` server-
 * side, and reads *that* record's own `organizationId` — the client's
 * only lever is which opaque session id it names, never which
 * organization it claims to act on.
 */
export type OnboardingAccessResult =
  | { authorized: true; session: AuthSession }
  | { authorized: false; response: NextResponse };

const UNAUTHENTICATED_RESPONSE = () => NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
const FORBIDDEN_RESPONSE = () => NextResponse.json({ error: 'Not authorized for this action.' }, { status: 403 });
const SESSION_NOT_FOUND_RESPONSE = () => NextResponse.json({ error: 'Onboarding session not found.' }, { status: 404 });

/**
 * Safe onboarding (2026-10). A mock/Wix-Members login is only trustworthy
 * on mock data (see lib/auth/authorize.ts#isNonIdentityAuthorizationPermitted);
 * on real Wix data every onboarding caller must hold an identity session.
 */
function isSessionSourceAcceptable(session: AuthSession): boolean {
  return session.user.source === 'identity' || isNonIdentityAuthorizationPermitted();
}

/** Admin-tier ACTIVE identity-format membership in the organization —
    the identity-mode counterpart of `hasAdminTierMembership` (which only
    reads the mock-login fixtures). */
async function hasIdentityAdminTierMembership(identityId: string, organizationId: string): Promise<boolean> {
  try {
    const dataAdapterMode = getDataAdapterMode();
    const membership = await getMembership(identityId, organizationId, dataAdapterMode);
    if (!isActiveMembership(membership)) return false;
    return await isAdminTier({ identityId, organizationId, roleKey: membership.role }, dataAdapterMode);
  } catch {
    return false;
  }
}

/**
 * Gate for `POST /api/onboarding/start` — the one action that must happen
 * before any organization (and therefore any membership) exists. Only a
 * platform administrator may create a brand-new tenant; see
 * `lib/auth/platformAdmin.ts`.
 */
export async function requirePlatformAdministrator(): Promise<OnboardingAccessResult> {
  const session = await getSession();
  if (!session) return { authorized: false, response: UNAUTHENTICATED_RESPONSE() };
  if (!isSessionSourceAcceptable(session)) return { authorized: false, response: FORBIDDEN_RESPONSE() };
  if (!isPlatformAdminUser(session.user.id)) return { authorized: false, response: FORBIDDEN_RESPONSE() };
  return { authorized: true, session };
}

/**
 * Gate for every other onboarding route. Authorized if the caller is
 * either (a) a platform administrator, (b) the specific user who called
 * `/start` for this session (`startedByUserId`) — authorized to keep
 * driving their own in-flight onboarding even before an administrator
 * membership exists for the new organization — or (c) already holds an
 * owner/administrator-tier active membership in the session's own
 * organization (the "resume onboarding only for their own organization
 * after the organization exists" case this phase's spec names). An
 * ordinary staff/caseManager/readOnly membership in that organization is
 * *not* sufficient (identity sessions are checked against their
 * identity-format membership, mock/wix sessions against the mock fixtures) — matching "Ordinary organization users may not...
 * complete onboarding... activate."
 */
export async function requireOnboardingSessionAccess(
  onboardingSession: OnboardingSession,
): Promise<OnboardingAccessResult> {
  const session = await getSession();
  if (!session) return { authorized: false, response: UNAUTHENTICATED_RESPONSE() };
  if (!isSessionSourceAcceptable(session)) return { authorized: false, response: FORBIDDEN_RESPONSE() };
  // Safe onboarding (2026-10): an onboarding for an organization this
  // deployment does not serve is indistinguishable from a missing one —
  // even for a platform administrator.
  if (!isOrganizationAllowedInDeployment(onboardingSession.organizationId)) {
    return { authorized: false, response: SESSION_NOT_FOUND_RESPONSE() };
  }

  const userId = session.user.id;
  const authorized =
    isPlatformAdminUser(userId) ||
    userId === onboardingSession.startedByUserId ||
    (session.user.source === 'identity'
      ? await hasIdentityAdminTierMembership(userId, onboardingSession.organizationId)
      : await hasAdminTierMembership(userId, onboardingSession.organizationId));

  if (!authorized) return { authorized: false, response: FORBIDDEN_RESPONSE() };
  return { authorized: true, session };
}
