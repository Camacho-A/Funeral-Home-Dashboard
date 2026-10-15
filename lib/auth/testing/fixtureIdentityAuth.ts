import type { AuthenticatedUser, AuthSession } from '../../../types/auth';
import type { Identity } from '../../../types/identity';
import type { IdentitySession } from '../../../types/identitySession';
import type { Membership } from '../../../types/membership';
import type { ResolveIdentitySessionResult } from '../resolveIdentitySession';
import { mockMembershipFixtures, mockOrganizationFixtures } from '../../../services/__mocks__/authFixtures';

/**
 * TEST-ONLY helpers (tenant-isolation hardening, 2026-10).
 *
 * With DATA_ADAPTER=wix, staff routes only honor `source: 'identity'`
 * sessions (requireAuthorizedOrganization rejects mock/wix sessions with
 * 401, exactly like production). Route tests that exercise wix-mode data
 * mapping therefore authenticate the way production does — an identity
 * session, re-validated by resolveIdentitySession and authorized by the
 * REAL resolveMembershipAuthorizationContext (including its deployment
 * allowlist) — with only the two Wix-backed lookups underneath replaced:
 *
 *   vi.mock('@/lib/auth/resolveIdentitySession', async () =>
 *     (await import('@/lib/auth/testing/fixtureIdentityAuth')).fixtureResolveIdentitySessionModule);
 *   vi.mock('@/services/membershipService', async (importOriginal) => ({
 *     ...(await importOriginal<typeof import('@/services/membershipService')>()),
 *     listMembershipsForIdentity: (await import('@/lib/auth/testing/fixtureIdentityAuth')).fixtureListMembershipsForIdentity,
 *   }));
 *
 * The memberships are derived 1:1 from services/__mocks__/authFixtures.ts's
 * mockMembershipFixtures (same user ids, organizations, roles and active
 * flags), so each test keeps exactly the authorization shape it was
 * written against — only the session source and the resolution path
 * change. Never import this from application code.
 */

const SESSION_ID_PREFIX = 'fixture-identity-session';

/** An identity-source session for one of authFixtures.ts's users. The
    optional `selectedOrganizationId` becomes the IdentitySession row's
    stored organization (as if previously selected/switched). */
export function fixtureIdentitySession(user: AuthenticatedUser, selectedOrganizationId?: string | null): AuthSession {
  const now = Math.floor(Date.now() / 1000);
  return {
    user: { ...user, source: 'identity' },
    issuedAt: now,
    expiresAt: now + 3600,
    sessionId: `${SESSION_ID_PREFIX}|${user.id}|${selectedOrganizationId ?? ''}`,
  };
}

function parseSessionId(sessionId: string | undefined): { identityId: string; organizationId: string | null } | null {
  if (!sessionId?.startsWith(`${SESSION_ID_PREFIX}|`)) return null;
  const [, identityId, organizationId] = sessionId.split('|');
  if (!identityId) return null;
  return { identityId, organizationId: organizationId || null };
}

export async function fixtureResolveIdentitySession(session: AuthSession): Promise<ResolveIdentitySessionResult> {
  const parsed = parseSessionId(session.sessionId);
  if (!parsed || parsed.identityId !== session.user.id) {
    return { valid: false, reason: 'session_not_found' };
  }
  const timestamp = '2026-01-01T00:00:00.000Z';
  const identity: Identity = {
    id: session.user.id,
    email: session.user.email,
    normalizedEmail: session.user.email.toLowerCase(),
    displayName: session.user.displayName,
    phone: null,
    status: 'active',
    emailVerified: true,
    passwordVersion: 0,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const identitySession: IdentitySession = {
    id: session.sessionId!,
    identityId: parsed.identityId,
    organizationId: parsed.organizationId,
    deviceId: 'fixture-device',
    deviceName: null,
    ipAddress: null,
    userAgent: null,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    lastSeenAt: timestamp,
    passwordVersionAtIssue: 0,
    revokedAt: null,
    createdAt: timestamp,
  };
  return { valid: true, identity, identitySession };
}

export const fixtureResolveIdentitySessionModule = { resolveIdentitySession: fixtureResolveIdentitySession };

export async function fixtureListMembershipsForIdentity(identityId: string): Promise<Membership[]> {
  const timestamp = '2026-01-01T00:00:00.000Z';
  return mockMembershipFixtures
    .filter((membership) => membership.userId === identityId)
    .map((membership, index) => {
      const organizationActive = mockOrganizationFixtures.find((org) => org.id === membership.organizationId)?.isActive === true;
      return {
        id: `fixture-membership-${identityId}-${index}`,
        identityId,
        organizationId: membership.organizationId,
        role: membership.role,
        status: membership.isActive && organizationActive ? 'active' : 'disabled',
        invitedBy: null,
        joinedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies Membership;
    });
}
