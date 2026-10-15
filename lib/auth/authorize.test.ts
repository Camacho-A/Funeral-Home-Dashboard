import { afterEach, describe, expect, it } from 'vitest';
import { hasAdminTierMembership, isNonIdentityAuthorizationPermitted, resolveAuthorizationContext } from './authorize';
import type { AuthSession } from '../../types/auth';
import {
  mockDefaultUser,
  mockMultiOrgUser,
  mockInactiveMembershipUser,
} from '../../services/__mocks__/authFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '../../services/__mocks__/organizationIds';

function sessionFor(user: AuthSession['user']): AuthSession {
  return { user, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };
}

describe('resolveAuthorizationContext — user with one organization', () => {
  it('auto-selects the single active membership when no organizationId is requested', () => {
    const result = resolveAuthorizationContext(sessionFor(mockDefaultUser));

    expect(result.granted).toBe(true);
    if (result.granted) {
      expect(result.context.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
      expect(result.context.userId).toBe(mockDefaultUser.id);
      expect(result.context.role).toBe('administrator');
    }
  });
});

describe('resolveAuthorizationContext — user with multiple organizations', () => {
  it('requires an explicit selection when more than one active membership exists', () => {
    const result = resolveAuthorizationContext(sessionFor(mockMultiOrgUser));

    expect(result.granted).toBe(false);
    if (!result.granted) expect(result.reason).toBe('selection_required');
  });

  it('grants access to whichever of the user\'s own organizations is explicitly requested', () => {
    const first = resolveAuthorizationContext(sessionFor(mockMultiOrgUser), DEFAULT_ORGANIZATION_ID);
    const second = resolveAuthorizationContext(sessionFor(mockMultiOrgUser), SECOND_MOCK_ORGANIZATION_ID);

    expect(first.granted).toBe(true);
    expect(second.granted).toBe(true);
    if (first.granted) expect(first.context.role).toBe('staff');
    if (second.granted) expect(second.context.role).toBe('caseManager');
  });
});

describe('resolveAuthorizationContext — inactive membership rejection', () => {
  it('rejects a user whose only membership row is inactive', () => {
    const result = resolveAuthorizationContext(sessionFor(mockInactiveMembershipUser));

    expect(result.granted).toBe(false);
    if (!result.granted) expect(result.reason).toBe('no_active_membership');
  });
});

describe('resolveAuthorizationContext — cross-organization / browser-supplied organizationId rejection', () => {
  it("rejects a requested organizationId the user has no membership in at all — the concrete 'never trust browser-supplied organizationId' enforcement", () => {
    const result = resolveAuthorizationContext(sessionFor(mockDefaultUser), SECOND_MOCK_ORGANIZATION_ID);

    expect(result.granted).toBe(false);
    if (!result.granted) expect(result.reason).toBe('organization_mismatch');
  });

  it('rejects a plausible-looking but entirely fabricated organizationId', () => {
    const result = resolveAuthorizationContext(sessionFor(mockDefaultUser), 'some-other-real-looking-org-id');

    expect(result.granted).toBe(false);
    if (!result.granted) expect(result.reason).toBe('organization_mismatch');
  });

  it("does not grant the multi-org user access to an organization that isn't one of their own memberships", () => {
    const result = resolveAuthorizationContext(sessionFor(mockMultiOrgUser), 'not-a-real-org');

    expect(result.granted).toBe(false);
    if (!result.granted) expect(result.reason).toBe('organization_mismatch');
  });
});

describe('resolveAuthorizationContext — no memberships at all', () => {
  it('rejects a user with zero membership rows', () => {
    const strangerUser: AuthSession['user'] = {
      id: 'mock-user-nobody',
      email: 'nobody@beacon.test',
      displayName: 'Nobody',
      source: 'mock',
    };
    const result = resolveAuthorizationContext(sessionFor(strangerUser));

    expect(result.granted).toBe(false);
    if (!result.granted) expect(result.reason).toBe('no_active_membership');
  });
});

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning).
 * `hasAdminTierMembership` — used by
 * lib/auth/requireOnboardingAccess.ts to let an organization's own
 * administrator resume its onboarding session.
 */
describe('hasAdminTierMembership', () => {
  it('returns true for an administrator-role active membership', async () => {
    // mockDefaultUser holds an 'administrator' membership in DEFAULT_ORGANIZATION_ID.
    expect(await hasAdminTierMembership(mockDefaultUser.id, DEFAULT_ORGANIZATION_ID)).toBe(true);
  });

  it('returns false for a staff-role membership — not admin-tier', async () => {
    // mockMultiOrgUser holds a 'staff' membership in DEFAULT_ORGANIZATION_ID.
    expect(await hasAdminTierMembership(mockMultiOrgUser.id, DEFAULT_ORGANIZATION_ID)).toBe(false);
  });

  it('returns false for a caseManager-role membership in a different organization — admin-tier but not owner/administrator', async () => {
    // mockMultiOrgUser holds a 'caseManager' membership in SECOND_MOCK_ORGANIZATION_ID.
    expect(await hasAdminTierMembership(mockMultiOrgUser.id, SECOND_MOCK_ORGANIZATION_ID)).toBe(false);
  });

  it('returns false for an inactive membership row, regardless of role', async () => {
    expect(await hasAdminTierMembership(mockInactiveMembershipUser.id, DEFAULT_ORGANIZATION_ID)).toBe(false);
  });

  it('returns false for a user with no membership in the organization at all', async () => {
    expect(await hasAdminTierMembership('mock-user-nobody', DEFAULT_ORGANIZATION_ID)).toBe(false);
  });
});

describe('tenant-isolation hardening (2026-10) — mock-fixture memberships never authorize live data', () => {
  const ENV_KEYS = ['DATA_ADAPTER', 'AUTH_ADAPTER', 'DEPLOYMENT_ORGANIZATION_IDS'] as const;
  const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  afterEach(() => {
    ENV_KEYS.forEach((key) => {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    });
  });

  it('resolveAuthorizationContext grants nothing when DATA_ADAPTER=wix — implicit or explicit', () => {
    process.env.DATA_ADAPTER = 'wix';
    expect(resolveAuthorizationContext(sessionFor(mockDefaultUser))).toEqual({ granted: false, reason: 'no_active_membership' });
    expect(resolveAuthorizationContext(sessionFor(mockDefaultUser), DEFAULT_ORGANIZATION_ID)).toEqual({ granted: false, reason: 'no_active_membership' });
  });

  it('resolveAuthorizationContext grants nothing even with an explicit AUTH_ADAPTER=mock on wix data', () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.AUTH_ADAPTER = 'mock';
    expect(resolveAuthorizationContext(sessionFor(mockDefaultUser), DEFAULT_ORGANIZATION_ID).granted).toBe(false);
  });

  it('fails closed on a misconfigured adapter value', () => {
    process.env.AUTH_ADAPTER = 'not-a-real-adapter';
    expect(isNonIdentityAuthorizationPermitted()).toBe(false);
    expect(resolveAuthorizationContext(sessionFor(mockDefaultUser), DEFAULT_ORGANIZATION_ID).granted).toBe(false);
    process.env.AUTH_ADAPTER = 'mock';
    process.env.DATA_ADAPTER = 'bogus';
    expect(isNonIdentityAuthorizationPermitted()).toBe(false);
  });

  it('is permitted on mock data (local development unchanged)', () => {
    expect(isNonIdentityAuthorizationPermitted()).toBe(true);
    expect(resolveAuthorizationContext(sessionFor(mockDefaultUser)).granted).toBe(true);
  });

  it('hasAdminTierMembership is false when DATA_ADAPTER=wix', async () => {
    process.env.DATA_ADAPTER = 'wix';
    expect(await hasAdminTierMembership(mockDefaultUser.id, DEFAULT_ORGANIZATION_ID)).toBe(false);
  });

  it('the deployment allowlist blocks an explicitly requested organization the user is a member of', () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = SECOND_MOCK_ORGANIZATION_ID;
    expect(resolveAuthorizationContext(sessionFor(mockMultiOrgUser), DEFAULT_ORGANIZATION_ID).granted).toBe(false);
    expect(resolveAuthorizationContext(sessionFor(mockMultiOrgUser), SECOND_MOCK_ORGANIZATION_ID).granted).toBe(true);
  });

  it('implicit selection never resolves to an organization outside the allowlist', () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = 'gus-camacho-jr';
    // mockDefaultUser's only membership is managed-cremations.
    expect(resolveAuthorizationContext(sessionFor(mockDefaultUser))).toEqual({ granted: false, reason: 'no_active_membership' });
    // A multi-org user with exactly one allowed membership is resolved to that one only.
    process.env.DEPLOYMENT_ORGANIZATION_IDS = SECOND_MOCK_ORGANIZATION_ID;
    const implicit = resolveAuthorizationContext(sessionFor(mockMultiOrgUser));
    expect(implicit.granted && implicit.context.organizationId).toBe(SECOND_MOCK_ORGANIZATION_ID);
  });
});
