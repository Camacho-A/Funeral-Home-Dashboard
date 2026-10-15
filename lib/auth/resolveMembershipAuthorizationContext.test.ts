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
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  identitySessionFixtures.length = lengths.sessions;
});

async function seedSession(identityId: string, organizationId: string | null = null) {
  const { createIdentitySession, setSessionOrganization } = await import('../../services/sessionService');
  const session = await createIdentitySession(
    { identityId, deviceId: 'device-1', passwordVersionAtIssue: 0, idFactory },
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

describe('resolveMembershipAuthorizationContext — deployment organization allowlist (2026-10)', () => {
  async function seedTwoOrgIdentity(identityId: string) {
    const { createMembership } = await import('../../services/membershipService');
    await createMembership({ identityId, organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', status: 'active', invitedBy: null, idFactory }, 'mock');
    await createMembership({ identityId, organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'owner', status: 'active', invitedBy: null, idFactory }, 'mock');
  }

  it('rejects an explicitly requested organization outside the allowlist, even with an active membership', async () => {
    const { resolveMembershipAuthorizationContext } = await import('./resolveMembershipAuthorizationContext');
    await seedTwoOrgIdentity('allowlist-requested-identity');
    const session = await seedSession('allowlist-requested-identity');
    process.env.DEPLOYMENT_ORGANIZATION_IDS = 'gus-camacho-jr';

    const result = await resolveMembershipAuthorizationContext(session, 'mock', DEFAULT_ORGANIZATION_ID);
    expect(result).toEqual({ granted: false, reason: 'organization_not_allowed' });
  });

  it("never honors a session's stored organization outside the allowlist — and never silently switches to another one", async () => {
    const { createMembership } = await import('../../services/membershipService');
    const { resolveMembershipAuthorizationContext } = await import('./resolveMembershipAuthorizationContext');
    const { getSessionById } = await import('../../services/sessionService');
    await seedTwoOrgIdentity('allowlist-stored-identity');
    await createMembership({ identityId: 'allowlist-stored-identity', organizationId: 'gus-camacho-jr', role: 'staff', status: 'active', invitedBy: null, idFactory }, 'mock');
    const session = await seedSession('allowlist-stored-identity', DEFAULT_ORGANIZATION_ID);
    process.env.DEPLOYMENT_ORGANIZATION_IDS = `gus-camacho-jr,${SECOND_MOCK_ORGANIZATION_ID}`;

    const result = await resolveMembershipAuthorizationContext(session, 'mock');
    expect(result).toEqual({ granted: false, reason: 'organization_not_allowed' });
    expect((await getSessionById(session.id, 'mock'))?.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
  });

  it('a stored disallowed organization is refused even when exactly one allowed membership exists (no silent switch)', async () => {
    const { resolveMembershipAuthorizationContext } = await import('./resolveMembershipAuthorizationContext');
    await seedTwoOrgIdentity('allowlist-stored-single-identity');
    const session = await seedSession('allowlist-stored-single-identity', DEFAULT_ORGANIZATION_ID);
    process.env.DEPLOYMENT_ORGANIZATION_IDS = SECOND_MOCK_ORGANIZATION_ID;

    expect(await resolveMembershipAuthorizationContext(session, 'mock')).toEqual({ granted: false, reason: 'organization_not_allowed' });
    // An explicit switch to the allowed organization still works.
    const switched = await resolveMembershipAuthorizationContext(session, 'mock', SECOND_MOCK_ORGANIZATION_ID);
    expect(switched.granted && switched.context.organizationId).toBe(SECOND_MOCK_ORGANIZATION_ID);
  });

  it('implicit selection only considers allowed memberships (auto-selects the one allowed organization)', async () => {
    const { resolveMembershipAuthorizationContext } = await import('./resolveMembershipAuthorizationContext');
    const { getSessionById } = await import('../../services/sessionService');
    await seedTwoOrgIdentity('allowlist-implicit-identity');
    const session = await seedSession('allowlist-implicit-identity');
    process.env.DEPLOYMENT_ORGANIZATION_IDS = SECOND_MOCK_ORGANIZATION_ID;

    const result = await resolveMembershipAuthorizationContext(session, 'mock');
    expect(result).toEqual({ granted: true, context: { userId: 'allowlist-implicit-identity', organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'owner' } });
    expect((await getSessionById(session.id, 'mock'))?.organizationId).toBe(SECOND_MOCK_ORGANIZATION_ID);
  });

  it('an identity whose memberships are all outside the allowlist has no usable membership here', async () => {
    const { resolveMembershipAuthorizationContext } = await import('./resolveMembershipAuthorizationContext');
    await seedTwoOrgIdentity('allowlist-none-identity');
    const session = await seedSession('allowlist-none-identity');
    process.env.DEPLOYMENT_ORGANIZATION_IDS = 'gus-camacho-jr';

    expect(await resolveMembershipAuthorizationContext(session, 'mock')).toEqual({ granted: false, reason: 'no_active_membership' });
  });
});
