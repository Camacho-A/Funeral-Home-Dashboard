import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { identityFixtures, membershipFixtures, MANORS_ADMIN_IDENTITY_ID } from './__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `membership-test-${idCounter}`;
}

let lengths: { identity: number; membership: number };
beforeEach(() => {
  idCounter = 0;
  lengths = { identity: identityFixtures.length, membership: membershipFixtures.length };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
});

describe('getMembership / listMembershipsForIdentity', () => {
  it('finds the seeded Manor\'s administrator membership', async () => {
    const { getMembership } = await import('./membershipService');
    const membership = await getMembership(MANORS_ADMIN_IDENTITY_ID, DEFAULT_ORGANIZATION_ID, 'mock');
    expect(membership?.role).toBe('administrator');
    expect(membership?.status).toBe('active');
  });

  it('returns null for an identity with no membership in an organization', async () => {
    const { getMembership } = await import('./membershipService');
    expect(await getMembership(MANORS_ADMIN_IDENTITY_ID, SECOND_MOCK_ORGANIZATION_ID, 'mock')).toBeNull();
  });
});

describe('createMembership', () => {
  it('creates a new active membership directly (non-invitation path)', async () => {
    const { createMembership } = await import('./membershipService');
    const { membership, isNew } = await createMembership(
      { identityId: 'some-identity', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', status: 'active', invitedBy: null, idFactory },
      'mock',
    );
    expect(isNew).toBe(true);
    expect(membership.joinedAt).not.toBeNull();
  });

  it('is idempotent — a second call for the same (identity, org) pair returns the existing membership', async () => {
    const { createMembership } = await import('./membershipService');
    const first = await createMembership(
      { identityId: 'dup-identity', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', status: 'active', invitedBy: null, idFactory },
      'mock',
    );
    const second = await createMembership(
      { identityId: 'dup-identity', organizationId: DEFAULT_ORGANIZATION_ID, role: 'owner', status: 'active', invitedBy: null, idFactory },
      'mock',
    );
    expect(second.isNew).toBe(false);
    expect(second.membership.id).toBe(first.membership.id);
    expect(second.membership.role).toBe('staff'); // unchanged by the second call's different role
  });

  it('a person can hold independent memberships in two different organizations', async () => {
    const { createMembership, listMembershipsForIdentity } = await import('./membershipService');
    await createMembership(
      { identityId: 'multi-org-identity', organizationId: DEFAULT_ORGANIZATION_ID, role: 'administrator', status: 'active', invitedBy: null, idFactory },
      'mock',
    );
    await createMembership(
      { identityId: 'multi-org-identity', organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'staff', status: 'active', invitedBy: null, idFactory },
      'mock',
    );
    const memberships = await listMembershipsForIdentity('multi-org-identity', 'mock');
    expect(memberships).toHaveLength(2);
    expect(memberships.map((m) => m.organizationId).sort()).toEqual([DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID].sort());
  });
});

describe('activateMembership', () => {
  it('transitions an invited membership to active and sets joinedAt', async () => {
    const { createMembership, activateMembership } = await import('./membershipService');
    const { membership } = await createMembership(
      { identityId: 'invited-identity', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', status: 'invited', invitedBy: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    expect(membership.joinedAt).toBeNull();

    const activated = await activateMembership(membership.id, 'mock');
    expect(activated?.status).toBe('active');
    expect(activated?.joinedAt).not.toBeNull();
  });

  it('is idempotent — activating an already-active membership is a no-op', async () => {
    const { activateMembership } = await import('./membershipService');
    const first = await activateMembership('membership-manors-admin', 'mock');
    expect(first?.status).toBe('active');
  });
});
