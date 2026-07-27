import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { identityFixtures, membershipFixtures } from './__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { OrganizationMembership } from '../types/organization';
import type { LegacyUserRecord } from './identityMigrationService';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `migration-test-${idCounter}`;
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

describe('migrateExistingUsers', () => {
  it('creates an active, email-verified identity with no password for a legacy user with one active membership', async () => {
    const { migrateExistingUsers } = await import('./identityMigrationService');
    const legacyUsers: LegacyUserRecord[] = [{ userId: 'legacy-1', email: 'legacy.one@example.com', displayName: 'Legacy One' }];
    const legacyMemberships: OrganizationMembership[] = [
      { organizationId: DEFAULT_ORGANIZATION_ID, userId: 'legacy-1', role: 'administrator', isActive: true },
    ];

    const report = await migrateExistingUsers(legacyUsers, legacyMemberships, idFactory, 'mock');
    expect(report.usersProcessed).toBe(1);
    expect(report.identitiesCreated).toBe(1);
    expect(report.membershipsCreated).toBe(1);

    const { getIdentityById, getIdentitySecrets } = await import('./identityService');
    const identity = await getIdentityById(report.users[0].identityId, 'mock');
    expect(identity?.status).toBe('active');
    expect(identity?.emailVerified).toBe(true);

    const secrets = await getIdentitySecrets(report.users[0].identityId, 'mock');
    expect(secrets?.passwordHash).toBeNull(); // no forced password — none existed to carry over

    const { getMembership } = await import('./membershipService');
    const membership = await getMembership(report.users[0].identityId, DEFAULT_ORGANIZATION_ID, 'mock');
    expect(membership?.role).toBe('administrator');
    expect(membership?.status).toBe('active');
  });

  it('migrates a legacy user with memberships in two organizations, dropping neither', async () => {
    const { migrateExistingUsers } = await import('./identityMigrationService');
    const legacyUsers: LegacyUserRecord[] = [{ userId: 'legacy-multi', email: 'legacy.multi@example.com', displayName: 'Legacy Multi' }];
    const legacyMemberships: OrganizationMembership[] = [
      { organizationId: DEFAULT_ORGANIZATION_ID, userId: 'legacy-multi', role: 'staff', isActive: true },
      { organizationId: SECOND_MOCK_ORGANIZATION_ID, userId: 'legacy-multi', role: 'caseManager', isActive: true },
    ];

    const report = await migrateExistingUsers(legacyUsers, legacyMemberships, idFactory, 'mock');
    expect(report.users[0].membershipsCreated).toBe(2);

    const { listMembershipsForIdentity } = await import('./membershipService');
    const memberships = await listMembershipsForIdentity(report.users[0].identityId, 'mock');
    expect(memberships).toHaveLength(2);
    expect(memberships.map((m) => m.organizationId).sort()).toEqual([DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID].sort());
  });

  it('carries over an inactive legacy membership as a disabled Membership row rather than dropping it', async () => {
    const { migrateExistingUsers } = await import('./identityMigrationService');
    const legacyUsers: LegacyUserRecord[] = [{ userId: 'legacy-inactive', email: 'legacy.inactive@example.com', displayName: 'Legacy Inactive' }];
    const legacyMemberships: OrganizationMembership[] = [
      { organizationId: DEFAULT_ORGANIZATION_ID, userId: 'legacy-inactive', role: 'staff', isActive: false },
    ];

    const report = await migrateExistingUsers(legacyUsers, legacyMemberships, idFactory, 'mock');
    expect(report.membershipsCreated).toBe(1);

    const { getMembership } = await import('./membershipService');
    const membership = await getMembership(report.users[0].identityId, DEFAULT_ORGANIZATION_ID, 'mock');
    expect(membership?.status).toBe('disabled');
  });

  it('skips a legacy user with no membership rows at all', async () => {
    const { migrateExistingUsers } = await import('./identityMigrationService');
    const legacyUsers: LegacyUserRecord[] = [{ userId: 'legacy-nomembership', email: 'legacy.nomembership@example.com', displayName: 'No Membership' }];

    const report = await migrateExistingUsers(legacyUsers, [], idFactory, 'mock');
    expect(report.usersProcessed).toBe(0);
    expect(report.users).toHaveLength(0);
  });

  it('is idempotent — running the same migration twice creates nothing new the second time', async () => {
    const { migrateExistingUsers } = await import('./identityMigrationService');
    const legacyUsers: LegacyUserRecord[] = [{ userId: 'legacy-repeat', email: 'legacy.repeat@example.com', displayName: 'Legacy Repeat' }];
    const legacyMemberships: OrganizationMembership[] = [
      { organizationId: DEFAULT_ORGANIZATION_ID, userId: 'legacy-repeat', role: 'staff', isActive: true },
    ];

    const first = await migrateExistingUsers(legacyUsers, legacyMemberships, idFactory, 'mock');
    const second = await migrateExistingUsers(legacyUsers, legacyMemberships, idFactory, 'mock');

    expect(first.identitiesCreated).toBe(1);
    expect(second.identitiesCreated).toBe(0);
    expect(second.identitiesExisting).toBe(1);
    expect(first.membershipsCreated).toBe(1);
    expect(second.membershipsCreated).toBe(0);
    expect(second.membershipsExisting).toBe(1);
    expect(first.users[0].identityId).toBe(second.users[0].identityId);
  });

  it('migrates the real mock fixtures (authFixtures.ts) end to end, reproducing the same shape identityFixtures.ts already hand-seeds for Manor\'s admin', async () => {
    const { migrateExistingUsers } = await import('./identityMigrationService');
    const { mockDefaultUser, mockMultiOrgUser, mockInactiveMembershipUser, mockMembershipFixtures } = await import('./__mocks__/authFixtures');
    const legacyUsers: LegacyUserRecord[] = [mockDefaultUser, mockMultiOrgUser, mockInactiveMembershipUser].map((u) => ({
      userId: u.id,
      email: u.email,
      displayName: u.displayName,
    }));

    const report = await migrateExistingUsers(legacyUsers, mockMembershipFixtures, idFactory, 'mock');

    // Dana's identity already exists (hand-seeded in identityFixtures.ts) —
    // this run must recognize her by email rather than duplicating her.
    const danaResult = report.users.find((u) => u.email === mockDefaultUser.email)!;
    expect(danaResult.isNewIdentity).toBe(false);
    expect(danaResult.membershipsExisting).toBe(1);

    // The multi-org user and the inactive-membership user are genuinely new.
    const multiOrgResult = report.users.find((u) => u.email === mockMultiOrgUser.email)!;
    expect(multiOrgResult.isNewIdentity).toBe(true);
    expect(multiOrgResult.membershipsCreated).toBe(2);

    const inactiveResult = report.users.find((u) => u.email === mockInactiveMembershipUser.email)!;
    expect(inactiveResult.isNewIdentity).toBe(true);
    const { getMembership } = await import('./membershipService');
    const inactiveMembership = await getMembership(inactiveResult.identityId, DEFAULT_ORGANIZATION_ID, 'mock');
    expect(inactiveMembership?.status).toBe('disabled');
  });
});
