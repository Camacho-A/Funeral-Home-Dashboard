import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { migrateStaffProfiles, type LegacyStaffProfileRecord } from './staffProfileMigrationService';
import { staffFixtures } from './__mocks__/fixtures';
import { identityFixtures, membershipFixtures } from './__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { hashPassword } from '../lib/identity/passwordHashing';

let lengths: { staff: number; identity: number; membership: number };
beforeEach(() => {
  lengths = { staff: staffFixtures.length, identity: identityFixtures.length, membership: membershipFixtures.length };
});
afterEach(() => {
  staffFixtures.length = lengths.staff;
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
});

const NOW = '2026-08-05T00:00:00.000Z';

function seedIdentity(id: string, email: string) {
  identityFixtures.push({
    id,
    email,
    normalizedEmail: email.toLowerCase(),
    displayName: 'Migration Test User',
    phone: null,
    status: 'active',
    emailVerified: true,
    passwordVersion: 1,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    passwordHash: hashPassword('BeaconDemo123!'),
    mfaSecretReference: null,
    mfaVerifiedAt: null,
    mfaRecoveryCodeHashes: [],
  });
}

function seedMembership(id: string, identityId: string) {
  membershipFixtures.push({
    id,
    identityId,
    organizationId: DEFAULT_ORGANIZATION_ID,
    role: 'officeStaff',
    status: 'active',
    invitedBy: null,
    joinedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe('migrateStaffProfiles', () => {
  it('dry run (apply: false) resolves a real Identity by email but writes nothing', async () => {
    seedIdentity('identity-migration-1', 'migration.one@managedcremations.test');
    const legacyRecords: LegacyStaffProfileRecord[] = [
      { legacyStaffProfileId: 'staff-migration-1', organizationId: DEFAULT_ORGANIZATION_ID, displayName: 'Migration One', role: 'staff', email: 'migration.one@managedcremations.test' },
    ];

    const report = await migrateStaffProfiles(legacyRecords, { apply: false, now: NOW }, 'mock');

    expect(report.apply).toBe(false);
    expect(report.resolved).toBe(1);
    expect(report.created).toBe(0);
    expect(report.rows[0]).toMatchObject({ status: 'resolved', resolvedIdentityId: 'identity-migration-1' });
    expect(staffFixtures.some((s) => s.id === 'staff-migration-1')).toBe(false);
  });

  it('dry run reports "unresolved", never inventing an Identity, when no email match exists', async () => {
    const legacyRecords: LegacyStaffProfileRecord[] = [
      { legacyStaffProfileId: 'staff-migration-ghost', organizationId: DEFAULT_ORGANIZATION_ID, displayName: 'Ghost', role: 'staff', email: 'no-such-person@managedcremations.test' },
    ];

    const report = await migrateStaffProfiles(legacyRecords, { apply: false, now: NOW }, 'mock');

    expect(report.unresolved).toBe(1);
    expect(report.rows[0]).toMatchObject({ status: 'unresolved', resolvedIdentityId: null });
    expect(identityFixtures.some((i) => i.email === 'no-such-person@managedcremations.test')).toBe(false);
  });

  it('apply creates a real StaffProfile row, carrying the resolved identityId/membershipId', async () => {
    seedIdentity('identity-migration-2', 'migration.two@managedcremations.test');
    seedMembership('membership-migration-2', 'identity-migration-2');
    const legacyRecords: LegacyStaffProfileRecord[] = [
      { legacyStaffProfileId: 'staff-migration-2', organizationId: DEFAULT_ORGANIZATION_ID, displayName: 'Migration Two', role: 'funeral_director', email: 'migration.two@managedcremations.test' },
    ];

    const report = await migrateStaffProfiles(legacyRecords, { apply: true, now: NOW }, 'mock');

    expect(report.created).toBe(1);
    const createdProfile = staffFixtures.find((s) => s.id === 'staff-migration-2');
    expect(createdProfile).toMatchObject({
      id: 'staff-migration-2',
      organizationId: DEFAULT_ORGANIZATION_ID,
      identityId: 'identity-migration-2',
      membershipId: 'membership-migration-2',
      displayName: 'Migration Two',
      role: 'funeral_director',
      isActive: true,
    });
  });

  it('is idempotent — re-running apply a second time creates nothing new', async () => {
    seedIdentity('identity-migration-3', 'migration.three@managedcremations.test');
    const legacyRecords: LegacyStaffProfileRecord[] = [
      { legacyStaffProfileId: 'staff-migration-3', organizationId: DEFAULT_ORGANIZATION_ID, displayName: 'Migration Three', role: 'staff', email: 'migration.three@managedcremations.test' },
    ];

    const first = await migrateStaffProfiles(legacyRecords, { apply: true, now: NOW }, 'mock');
    const second = await migrateStaffProfiles(legacyRecords, { apply: true, now: NOW }, 'mock');

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.alreadyExisting).toBe(1);
    expect(staffFixtures.filter((s) => s.id === 'staff-migration-3')).toHaveLength(1);
  });

  it('resolves the real Manor\'s Cremation fixture rows (staff-dana/chris/priya) — already-existing since #268 seeded them', async () => {
    const legacyRecords: LegacyStaffProfileRecord[] = [
      { legacyStaffProfileId: 'staff-dana', organizationId: DEFAULT_ORGANIZATION_ID, displayName: 'Dana', role: 'funeral_director', email: 'dana@managedcremations.test' },
      { legacyStaffProfileId: 'staff-chris', organizationId: DEFAULT_ORGANIZATION_ID, displayName: 'Chris', role: 'funeral_director', email: 'chris@managedcremations.test' },
      { legacyStaffProfileId: 'staff-priya', organizationId: DEFAULT_ORGANIZATION_ID, displayName: 'Priya', role: 'staff', email: 'priya@managedcremations.test' },
    ];

    const report = await migrateStaffProfiles(legacyRecords, { apply: true, now: NOW }, 'mock');

    expect(report.alreadyExisting).toBe(3);
    expect(report.created).toBe(0);
  });
});
