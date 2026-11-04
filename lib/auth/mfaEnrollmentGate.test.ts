import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '../../types/auth';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '../../services/__mocks__/identityFixtures';
import { mockOrganizationFixtures } from '../../services/__mocks__/authFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '../../services/__mocks__/organizationIds';
import { generateTotpCode } from '../identity/totp';

/**
 * MFA enrollment gate (2026-11). An organization that requires MFA refuses
 * every organization-scoped request from a member who has not enrolled —
 * decided from server-side data (the identity row, the organization's
 * record), in the one resolver every identity-session route authorizes
 * through. Fictional identities; mock data only.
 *
 * REQUIRED = an organization configured to require MFA (the default mock
 * organization, switched on for these tests); OPTIONAL = one that doesn't.
 */
const REQUIRED = DEFAULT_ORGANIZATION_ID;
const OPTIONAL = SECOND_MOCK_ORGANIZATION_ID;

let mockSession: AuthSession | null = null;
vi.mock('./session', () => ({
  getSession: async () => mockSession,
  createSession: vi.fn(async () => undefined),
  clearSession: vi.fn(async () => undefined),
}));

const { requireAuthorizedOrganization } = await import('./requireAuthorizedOrganization');
const { requireIdentitySession } = await import('./requireIdentitySession');
const { resolveMembershipAuthorizationContext } = await import('./resolveMembershipAuthorizationContext');
const { createMembership } = await import('../../services/membershipService');
const { createIdentitySession } = await import('../../services/sessionService');
const { findOrCreateIdentity, getIdentityById, updateIdentity } = await import('../../services/identityService');
const { beginMfaEnrollment, verifyMfaEnrollment } = await import('../../services/mfaService');
const policy = await import('../../services/mfaPolicyService');
const organizations = await import('../../services/organizationProvisioningService');

let counter = 0;
const idFactory = () => `mfa-gate-${++counter}`;
let lengths: { identity: number; membership: number; sessions: number };
const requiredOrg = mockOrganizationFixtures.find((o) => o.id === REQUIRED) as unknown as { requireMfa?: boolean };

beforeEach(() => {
  counter = 0;
  lengths = { identity: identityFixtures.length, membership: membershipFixtures.length, sessions: identitySessionFixtures.length };
  requiredOrg.requireMfa = true;
  policy.clearOrganizationMfaPolicyCache();
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
  delete requiredOrg.requireMfa;
  mockSession = null;
  vi.restoreAllMocks();
});

/** A fictional staff member, signed in, with active memberships in `orgs`. */
async function signIn(email: string, orgs: string[], extraUserFields: Record<string, unknown> = {}) {
  const { identity: created } = await findOrCreateIdentity({ email, displayName: 'Fictional Staff', idFactory }, 'mock');
  const identity = (await updateIdentity(created.id, { status: 'active', emailVerified: true }, 'mock'))!;
  for (const organizationId of orgs) {
    await createMembership({ identityId: identity.id, organizationId, role: 'staff', status: 'active', invitedBy: null, idFactory }, 'mock');
  }
  const session = await createIdentitySession({ identityId: identity.id, deviceId: 'device-1', passwordVersionAtIssue: identity.passwordVersion, idFactory }, 'mock');
  mockSession = {
    user: { id: identity.id, email, displayName: 'Fictional Staff', source: 'identity', ...extraUserFields } as AuthSession['user'],
    issuedAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
    sessionId: session.id,
  };
  return { identity, session };
}

async function enroll(identityId: string) {
  const { secret } = await beginMfaEnrollment(identityId, 'mock');
  expect((await verifyMfaEnrollment(identityId, generateTotpCode(secret), 'mock')).success).toBe(true);
}

async function expectBlocked(organizationId: string) {
  const result = await requireAuthorizedOrganization(organizationId);
  expect(result.authorized).toBe(false);
  if (result.authorized) return;
  expect(result.response.status).toBe(403);
  expect(await result.response.json()).toMatchObject({ code: 'mfa_enrollment_required', setupPath: '/mfa-setup' });
}

describe('MFA enrollment gate', () => {
  it('existing enrolled staff are unaffected', async () => {
    const { identity } = await signIn('enrolled@fictional.test', [REQUIRED]);
    await enroll(identity.id);
    expect((await requireAuthorizedOrganization(REQUIRED)).authorized).toBe(true);
  });

  it('newly invited staff in an organization that requires MFA are refused every organization API until they enroll — then allowed without signing in again', async () => {
    const { identity } = await signIn('new.hire@fictional.test', [REQUIRED]);
    await expectBlocked(REQUIRED);

    await enroll(identity.id);
    expect((await requireAuthorizedOrganization(REQUIRED)).authorized).toBe(true);
  });

  it('the routes the identity-session pages use (roles, invitations, activity…) are refused too', async () => {
    const { session } = await signIn('new.hire2@fictional.test', [REQUIRED]);
    expect(await resolveMembershipAuthorizationContext(session, 'mock', REQUIRED)).toEqual({ granted: false, reason: 'mfa_enrollment_required' });
    // …including implicit selection (the portal layout's path).
    expect(await resolveMembershipAuthorizationContext(session, 'mock')).toEqual({ granted: false, reason: 'mfa_enrollment_required' });
  });

  it('enrollment and sign-out stay reachable: the identity-only gate still admits the not-yet-enrolled member', async () => {
    await signIn('setup@fictional.test', [REQUIRED]);
    expect((await requireIdentitySession()).authorized).toBe(true);
  });

  it('an organization that does not require MFA is unaffected', async () => {
    await signIn('optional@fictional.test', [OPTIONAL]);
    expect((await requireAuthorizedOrganization(OPTIONAL)).authorized).toBe(true);
  });

  it('incomplete enrollment (setup key issued, never verified) stays blocked', async () => {
    const { identity } = await signIn('incomplete@fictional.test', [REQUIRED]);
    await beginMfaEnrollment(identity.id, 'mock');
    expect((await getIdentityById(identity.id, 'mock'))?.mfaEnabled).toBe(false);
    await expectBlocked(REQUIRED);
  });

  it('interrupted enrollment recovers by starting again: the new key replaces the old one, and only it turns MFA on', async () => {
    const { identity } = await signIn('interrupted@fictional.test', [REQUIRED]);
    const { secret: abandoned } = await beginMfaEnrollment(identity.id, 'mock');
    const { secret: fresh } = await beginMfaEnrollment(identity.id, 'mock');
    if (generateTotpCode(abandoned) !== generateTotpCode(fresh)) {
      expect((await verifyMfaEnrollment(identity.id, generateTotpCode(abandoned), 'mock')).success).toBe(false);
      await expectBlocked(REQUIRED);
    }
    expect((await verifyMfaEnrollment(identity.id, generateTotpCode(fresh), 'mock')).success).toBe(true);
    expect((await requireAuthorizedOrganization(REQUIRED)).authorized).toBe(true);
  });

  it('a forged "enrolled" claim in the session cookie changes nothing — the identity row decides', async () => {
    await signIn('forged@fictional.test', [REQUIRED], { mfaEnabled: true, mfaVerified: true });
    await expectBlocked(REQUIRED);
  });

  it("is per organization: the same unenrolled member works in the optional organization and is refused in the required one", async () => {
    const { identity } = await signIn('two.homes@fictional.test', [REQUIRED, OPTIONAL]);
    expect((await requireAuthorizedOrganization(OPTIONAL)).authorized).toBe(true);
    await expectBlocked(REQUIRED);
    await enroll(identity.id);
    expect((await requireAuthorizedOrganization(REQUIRED)).authorized).toBe(true);
    expect((await requireAuthorizedOrganization(OPTIONAL)).authorized).toBe(true);
  });

  it("enrollment never grants another organization: a non-member gets the generic 403 and the organization's policy is never read", async () => {
    const { identity } = await signIn('outsider@fictional.test', [OPTIONAL]);
    await enroll(identity.id);
    const read = vi.spyOn(organizations, 'getOrganization');
    const result = await requireAuthorizedOrganization(REQUIRED);
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(403);
      expect(await result.response.json()).not.toHaveProperty('code');
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("a not-yet-enrolled non-member is not told whether that organization requires MFA", async () => {
    await signIn('prober@fictional.test', [OPTIONAL]);
    const result = await requireAuthorizedOrganization(REQUIRED);
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(await result.response.json()).toEqual({ error: 'Not authorized for this organization.' });
  });

  it('fails closed when the organization policy cannot be read', async () => {
    await signIn('outage@fictional.test', [REQUIRED]);
    vi.spyOn(organizations, 'getOrganization').mockRejectedValue(new Error('Wix unavailable (fictional)'));
    await expect(requireAuthorizedOrganization(REQUIRED)).rejects.toThrow('Wix unavailable');
  });
});
