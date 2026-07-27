import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { identityFixtures, membershipFixtures, identitySessionFixtures } from '../../services/__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '../../services/__mocks__/organizationIds';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `resolve-membership-test-${idCounter}`;
}

let lengths: { identity: number; membership: number; sessions: number };
beforeEach(() => {
  idCounter = 0;
  lengths = { identity: identityFixtures.length, membership: membershipFixtures.length, sessions: identitySessionFixtures.length };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
});

async function seedSession(identityId: string, organizationId: string | null = null) {
  const { createIdentitySession, setSessionOrganization } = await import('../../services/sessionService');
  const session = await createIdentitySession(
    { identityId, deviceId: 'device-1', rememberDevice: false, passwordVersionAtIssue: 0, idFactory },
    'mock',
  );
  if (organizationId) return (await setSessionOrganization(session.id, organizationId, 'mock'))!;
  return session;
}

describe('resolveMembershipAuthorizationContext', () => {
  it('rejects an identity with no active membership anywhere', async () => {
    const { resolveMembershipAuthorizationContext } = await import('./resolveMembershipAuthorizationContext');
    const session = await seedSession('no-membership-identity');

    const result = await resolveMembershipAuthorizationContext(session, 'mock');
    expect(result).toEqual({ granted: false, reason: 'no_active_membership' });
  });

  it('auto-selects and persists the identity\'s one active membership when no organization is yet selected', async () => {
    const { createMembership } = await import('../../services/membershipService');
    const { resolveMembershipAuthorizationContext } = await import('./resolveMembershipAuthorizationContext');
    const { getSessionById } = await import('../../services/sessionService');
    const { membership } = await createMembership(
      { identityId: 'single-membership-identity', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', status: 'active', invitedBy: null, idFactory },
      'mock',
    );
    const session = await seedSession('single-membership-identity');
    expect(session.organizationId).toBeNull();

    const result = await resolveMembershipAuthorizationContext(session, 'mock');
    expect(result).toEqual({ granted: true, context: { userId: 'single-membership-identity', organizationId: membership.organizationId, role: 'staff' } });

    const persisted = await getSessionById(session.id, 'mock');
    expect(persisted?.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
  });

  it('requires explicit selection when the identity has more than one active membership and none is yet selected', async () => {
    const { createMembership } = await import('../../services/membershipService');
    const { resolveMembershipAuthorizationContext } = await import('./resolveMembershipAuthorizationContext');
    await createMembership(
      { identityId: 'multi-membership-identity', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', status: 'active', invitedBy: null, idFactory },
      'mock',
    );
    await createMembership(
      { identityId: 'multi-membership-identity', organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'owner', status: 'active', invitedBy: null, idFactory },
      'mock',
    );
    const session = await seedSession('multi-membership-identity');

    const result = await resolveMembershipAuthorizationContext(session, 'mock');
    expect(result).toEqual({ granted: false, reason: 'selection_required' });
  });

  it('honors the session\'s already-selected organization when it still maps to an active membership', async () => {
    const { createMembership } = await import('../../services/membershipService');
    const { resolveMembershipAuthorizationContext } = await import('./resolveMembershipAuthorizationContext');
    await createMembership(
      { identityId: 'preselected-identity', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', status: 'active', invitedBy: null, idFactory },
      'mock',
    );
    await createMembership(
      { identityId: 'preselected-identity', organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'owner', status: 'active', invitedBy: null, idFactory },
      'mock',
    );
    const session = await seedSession('preselected-identity', SECOND_MOCK_ORGANIZATION_ID);

    const result = await resolveMembershipAuthorizationContext(session, 'mock');
    expect(result).toEqual({ granted: true, context: { userId: 'preselected-identity', organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'owner' } });
  });

  it('never trusts a caller-supplied organizationId that the identity has no active membership in', async () => {
    const { createMembership } = await import('../../services/membershipService');
    const { resolveMembershipAuthorizationContext } = await import('./resolveMembershipAuthorizationContext');
    await createMembership(
      { identityId: 'mismatch-identity', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', status: 'active', invitedBy: null, idFactory },
      'mock',
    );
    const session = await seedSession('mismatch-identity');

    const result = await resolveMembershipAuthorizationContext(session, 'mock', SECOND_MOCK_ORGANIZATION_ID);
    expect(result).toEqual({ granted: false, reason: 'organization_mismatch' });
  });

  it('grants an explicitly requested organizationId when an active membership backs it (switch-organization)', async () => {
    const { createMembership } = await import('../../services/membershipService');
    const { resolveMembershipAuthorizationContext } = await import('./resolveMembershipAuthorizationContext');
    await createMembership(
      { identityId: 'switching-identity', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', status: 'active', invitedBy: null, idFactory },
      'mock',
    );
    await createMembership(
      { identityId: 'switching-identity', organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'caseManager', status: 'active', invitedBy: null, idFactory },
      'mock',
    );
    const session = await seedSession('switching-identity', DEFAULT_ORGANIZATION_ID);

    const result = await resolveMembershipAuthorizationContext(session, 'mock', SECOND_MOCK_ORGANIZATION_ID);
    expect(result).toEqual({ granted: true, context: { userId: 'switching-identity', organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'caseManager' } });
  });

  it('falls through to reselect when the session\'s stored organization is no longer an active membership', async () => {
    const { createMembership } = await import('../../services/membershipService');
    const { resolveMembershipAuthorizationContext } = await import('./resolveMembershipAuthorizationContext');
    const { membership: remaining } = await createMembership(
      { identityId: 'removed-membership-identity', organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'staff', status: 'active', invitedBy: null, idFactory },
      'mock',
    );
    // The session still points at DEFAULT_ORGANIZATION_ID, but that
    // membership was never created (simulating removal) — only
    // SECOND_MOCK_ORGANIZATION_ID is actually active.
    const session = await seedSession('removed-membership-identity', DEFAULT_ORGANIZATION_ID);

    const result = await resolveMembershipAuthorizationContext(session, 'mock');
    expect(result).toEqual({ granted: true, context: { userId: 'removed-membership-identity', organizationId: remaining.organizationId, role: 'staff' } });
  });

  it('excludes invited/disabled/removed memberships from the active set', async () => {
    const { createMembership } = await import('../../services/membershipService');
    const { resolveMembershipAuthorizationContext } = await import('./resolveMembershipAuthorizationContext');
    await createMembership(
      { identityId: 'invited-only-identity', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', status: 'invited', invitedBy: null, idFactory },
      'mock',
    );
    const session = await seedSession('invited-only-identity');

    const result = await resolveMembershipAuthorizationContext(session, 'mock');
    expect(result).toEqual({ granted: false, reason: 'no_active_membership' });
  });
});
