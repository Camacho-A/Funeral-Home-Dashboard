import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join } from 'path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  list,
  getById,
  resolveStaffProfileForCaller,
  assertAssignableStaffProfile,
  create,
  deactivate,
  StaffAssignmentError,
} from './staffProfileService';
import { staffFixtures } from './__mocks__/fixtures';
import { membershipFixtures, MANORS_ADMIN_IDENTITY_ID, MANORS_CHRIS_IDENTITY_ID } from './__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { AuthorizationContext } from '../types/authorization';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `staff-profile-test-${idCounter}`;
}

let lengths: { staff: number; membership: number };
beforeEach(() => {
  idCounter = 0;
  lengths = { staff: staffFixtures.length, membership: membershipFixtures.length };
});
afterEach(() => {
  staffFixtures.length = lengths.staff;
  membershipFixtures.length = lengths.membership;
});

const administrator = { identityId: MANORS_ADMIN_IDENTITY_ID, organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'administrator' };
const readOnly = { identityId: 'identity-readonly-test', organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly' };

describe('list', () => {
  it('returns only active staff profiles for the given organization', async () => {
    staffFixtures.push({
      id: 'staff-inactive-test',
      organizationId: DEFAULT_ORGANIZATION_ID,
      identityId: 'identity-inactive-test',
      membershipId: null,
      displayName: 'Inactive Staffer',
      role: 'staff',
      isActive: false,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const profiles = await list(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(profiles.every((p) => p.isActive)).toBe(true);
    expect(profiles.some((p) => p.id === 'staff-inactive-test')).toBe(false);
  });

  it('never crosses tenant boundaries', async () => {
    const profiles = await list(SECOND_MOCK_ORGANIZATION_ID, 'mock');
    expect(profiles).toEqual([]);
  });
});

describe('getById', () => {
  it('finds a seeded profile by id + organization', async () => {
    const profile = await getById(DEFAULT_ORGANIZATION_ID, 'staff-dana', 'mock');
    expect(profile?.displayName).toBe('Dana');
  });

  it('returns null for a profile id from a different organization', async () => {
    expect(await getById(SECOND_MOCK_ORGANIZATION_ID, 'staff-dana', 'mock')).toBeNull();
  });
});

describe('resolveStaffProfileForCaller', () => {
  it("resolves the caller's own StaffProfile by (organizationId, identityId)", async () => {
    const context: AuthorizationContext = { userId: MANORS_CHRIS_IDENTITY_ID, organizationId: DEFAULT_ORGANIZATION_ID, role: 'funeralDirector' };
    const profile = await resolveStaffProfileForCaller(context, 'mock');
    expect(profile?.id).toBe('staff-chris');
  });

  it('returns null when no StaffProfile is linked to the caller identity in this organization', async () => {
    const context: AuthorizationContext = { userId: 'identity-with-no-staff-profile', organizationId: DEFAULT_ORGANIZATION_ID, role: 'administrator' };
    expect(await resolveStaffProfileForCaller(context, 'mock')).toBeNull();
  });
});

describe('assertAssignableStaffProfile', () => {
  it('succeeds and returns the profile for an active, in-org, permitted assignment', async () => {
    const profile = await assertAssignableStaffProfile(
      { organizationId: DEFAULT_ORGANIZATION_ID, staffProfileId: 'staff-dana', permission: 'case.update', actor: administrator },
      'mock',
    );
    expect(profile.id).toBe('staff-dana');
  });

  it('rejects a nonexistent staff profile id', async () => {
    await expect(
      assertAssignableStaffProfile({ organizationId: DEFAULT_ORGANIZATION_ID, staffProfileId: 'staff-does-not-exist', permission: 'case.update', actor: administrator }, 'mock'),
    ).rejects.toThrow(StaffAssignmentError);
  });

  it('rejects a staff profile from a different organization', async () => {
    await expect(
      assertAssignableStaffProfile({ organizationId: SECOND_MOCK_ORGANIZATION_ID, staffProfileId: 'staff-dana', permission: 'case.update', actor: administrator }, 'mock'),
    ).rejects.toThrow(StaffAssignmentError);
  });

  it('rejects a deactivated staff profile', async () => {
    const index = staffFixtures.findIndex((s) => s.id === 'staff-priya');
    staffFixtures[index] = { ...staffFixtures[index], isActive: false };
    await expect(
      assertAssignableStaffProfile({ organizationId: DEFAULT_ORGANIZATION_ID, staffProfileId: 'staff-priya', permission: 'case.update', actor: administrator }, 'mock'),
    ).rejects.toThrow(StaffAssignmentError);
  });

  it('rejects when the linked membership is no longer active (cross-org stale link or disabled membership)', async () => {
    const membershipIndex = membershipFixtures.findIndex((m) => m.id === 'membership-manors-chris');
    membershipFixtures[membershipIndex] = { ...membershipFixtures[membershipIndex], status: 'disabled' };
    await expect(
      assertAssignableStaffProfile({ organizationId: DEFAULT_ORGANIZATION_ID, staffProfileId: 'staff-chris', permission: 'case.update', actor: administrator }, 'mock'),
    ).rejects.toThrow(StaffAssignmentError);
  });

  it('rejects when the caller lacks the required permission — never a StaffProfile.role string comparison', async () => {
    await expect(
      assertAssignableStaffProfile({ organizationId: DEFAULT_ORGANIZATION_ID, staffProfileId: 'staff-dana', permission: 'task.assign', actor: readOnly }, 'mock'),
    ).rejects.toThrow(StaffAssignmentError);
  });
});

describe('create', () => {
  it('creates a new active staff profile', async () => {
    const profile = await create(
      DEFAULT_ORGANIZATION_ID,
      { identityId: 'identity-new-hire', membershipId: null, displayName: 'New Hire', role: 'staff', idFactory },
      'mock',
    );
    expect(profile.isActive).toBe(true);
    expect(staffFixtures.some((s) => s.id === profile.id)).toBe(true);
  });
});

describe('deactivate', () => {
  it('sets isActive to false without removing the row (never hard-deleted)', async () => {
    const deactivated = await deactivate(DEFAULT_ORGANIZATION_ID, 'staff-priya', 'mock');
    expect(deactivated.isActive).toBe(false);
    expect(staffFixtures.some((s) => s.id === 'staff-priya')).toBe(true);
  });

  it('throws for a staff profile id from a different organization', async () => {
    await expect(deactivate(SECOND_MOCK_ORGANIZATION_ID, 'staff-priya', 'mock')).rejects.toThrow(StaffAssignmentError);
  });
});

/**
 * Phase 30 (Identity Model Hardening & Staff Assignment Unification):
 * mirrors `services/notificationService.test.ts`'s own "orchestration
 * boundary (structural)" pattern — a source-tree walk confirming
 * `staffProfileService.ts` (and its own mapper) is the *only* code that
 * ever touches the `staffProfiles` Wix collection directly. Every other
 * file that needs a `StaffProfile` (casesService.ts, tasksService.ts,
 * schedulingService.ts, resourceService.ts, recipientResolver.ts, every
 * cases/tasks/scheduling/resources route) goes through this service's own
 * exported functions (`list`/`getById`/`resolveStaffProfileForCaller`/
 * `assertAssignableStaffProfile`/`assertStaffProfileIsActiveAndInOrganization`/
 * `create`/`deactivate`) — never a second, ad hoc query against the raw
 * collection name.
 */
describe('StaffProfileService orchestration boundary (structural)', () => {
  const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);

  function walk(dir: string, results: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath, results);
      } else if (['.ts', '.tsx'].includes(extname(fullPath)) && !fullPath.endsWith('.test.ts') && !fullPath.endsWith('.test.tsx')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const root = join(__dirname, '..');
  const allFiles = walk(root);
  const staffProfileServicePath = join(__dirname, 'staffProfileService.ts');
  const staffProfileMapperPath = join(root, 'lib', 'wixStaffProfileMapper.ts');

  it("only staffProfileService.ts (and its own mapper) reference the 'staffProfiles' Wix collection", () => {
    const collectionPattern = /['"]staffProfiles['"]/;
    const offenders = allFiles.filter((filePath) => {
      if (filePath === staffProfileServicePath || filePath === staffProfileMapperPath) return false;
      return collectionPattern.test(readFileSync(filePath, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });
});
