import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  seedPermissionCatalog,
  seedPlatformDefaultRoles,
  seedDefaultRoles,
  listRolesForOrganization,
  listOrganizationRoleEnablements,
  createCustomRole,
  cloneRole,
  updateRole,
  deleteRole,
  assignRole,
  removeRole,
  setMembershipStatus,
  listAuditEntries,
  RoleServiceError,
} from './roleService';
import { resolvePermissionKeysForRole } from './permissionService';
import { updateMembership } from './membershipService';
import { withOrganizationRoleLock, assertFenceStillCurrent, commitProtectedWrite, LockLeaseLostError } from './organizationLockService';
import { membershipFixtures, MANORS_ADMIN_IDENTITY_ID } from './__mocks__/identityFixtures';
import {
  permissionFixtures,
  roleFixtures,
  rolePermissionFixtures,
  organizationRoleFixtures,
  organizationRoleAuditEntryFixtures,
  organizationRoleLockFixtures,
  organizationRoleWriteClaimFixtures,
} from './__mocks__/rbacFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { Membership } from '../types/membership';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `role-test-${idCounter}`;
}

let lengths: { permission: number; role: number; rolePermission: number; organizationRole: number; audit: number; locks: number; claims: number };
let membershipSnapshot: Membership[];
beforeEach(() => {
  idCounter = 0;
  lengths = {
    permission: permissionFixtures.length,
    role: roleFixtures.length,
    rolePermission: rolePermissionFixtures.length,
    organizationRole: organizationRoleFixtures.length,
    audit: organizationRoleAuditEntryFixtures.length,
    locks: organizationRoleLockFixtures.length,
    claims: organizationRoleWriteClaimFixtures.length,
  };
  // A full deep snapshot, not just a length — several tests here mutate a
  // pre-existing seeded row (e.g. Manor's Cremation's real administrator
  // membership) *in place* via updateMembership. Truncating the array back
  // to its original length would remove rows pushed during the test but
  // would leave that in-place mutation on the pre-existing row permanently
  // in effect for every later test in this file.
  membershipSnapshot = membershipFixtures.map((m) => ({ ...m }));
});
afterEach(() => {
  membershipFixtures.length = 0;
  membershipFixtures.push(...membershipSnapshot);
  permissionFixtures.length = lengths.permission;
  roleFixtures.length = lengths.role;
  rolePermissionFixtures.length = lengths.rolePermission;
  organizationRoleFixtures.length = lengths.organizationRole;
  organizationRoleAuditEntryFixtures.length = lengths.audit;
  organizationRoleLockFixtures.length = lengths.locks;
  organizationRoleWriteClaimFixtures.length = lengths.claims;
});

function pushMembership(overrides: Partial<Membership> & { id: string; identityId: string; role: string }): Membership {
  const membership: Membership = {
    organizationId: DEFAULT_ORGANIZATION_ID,
    status: 'active',
    invitedBy: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  membershipFixtures.push(membership);
  return membership;
}

describe('seedPermissionCatalog', () => {
  it('is idempotent — already-seeded permissions (mock fixtures) are not duplicated', async () => {
    const before = permissionFixtures.length;
    await seedPermissionCatalog('mock');
    expect(permissionFixtures.length).toBe(before);
  });
});

describe('seedPlatformDefaultRoles', () => {
  it('is idempotent — already-seeded default roles (mock fixtures) are returned unchanged, not duplicated', async () => {
    const before = roleFixtures.length;
    const roles = await seedPlatformDefaultRoles('mock');
    expect(roles).toHaveLength(7);
    expect(roleFixtures.length).toBe(before);
  });

  it('concurrent seeding calls never create duplicate role or rolePermission rows', async () => {
    const beforeRoles = roleFixtures.length;
    const beforeGrants = rolePermissionFixtures.length;
    await Promise.all([seedPlatformDefaultRoles('mock'), seedPlatformDefaultRoles('mock'), seedPlatformDefaultRoles('mock')]);
    expect(roleFixtures.length).toBe(beforeRoles);
    expect(rolePermissionFixtures.length).toBe(beforeGrants);
  });
});

describe('seedDefaultRoles', () => {
  it('is idempotent for an organization that already has enablements', async () => {
    const before = organizationRoleFixtures.length;
    const { enablements, isNew } = await seedDefaultRoles(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(isNew).toBe(false);
    expect(enablements).toHaveLength(7);
    expect(organizationRoleFixtures.length).toBe(before);
  });

  it('seeds 7 enablements for a brand-new organization', async () => {
    const { enablements, isNew } = await seedDefaultRoles('brand-new-org', 'mock');
    expect(isNew).toBe(true);
    expect(enablements).toHaveLength(7);
    const roles = await listRolesForOrganization('brand-new-org', 'mock');
    expect(roles.map((r) => r.key).sort()).toEqual(['accounting', 'administrator', 'arranger', 'funeralDirector', 'manager', 'officeStaff', 'readOnly']);
  });

  it('concurrent seeding for the same brand-new organization creates exactly 7 enablements, never 14', async () => {
    const orgId = 'concurrent-seed-org';
    await Promise.all([seedDefaultRoles(orgId, 'mock'), seedDefaultRoles(orgId, 'mock'), seedDefaultRoles(orgId, 'mock')]);
    const enablements = await listOrganizationRoleEnablements(orgId, 'mock');
    expect(enablements).toHaveLength(7);
    // No duplicate roleIds among the enablements — three concurrent
    // seeding attempts produced one enablement per default role, not
    // three of each.
    expect(new Set(enablements.map((e) => e.roleId)).size).toBe(7);
  });
});

describe('listRolesForOrganization', () => {
  it("returns Manor's Cremation's seven seeded default roles", async () => {
    const roles = await listRolesForOrganization(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(roles).toHaveLength(7);
    expect(roles.every((r) => r.isSystemDefault)).toBe(true);
  });
});

describe('createCustomRole', () => {
  it('creates a new custom role scoped to the organization, with its own permission set', async () => {
    const role = await createCustomRole(
      { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Night Shift Coordinator', description: 'After-hours case intake only', permissions: ['case.read', 'case.create'], actorIdentityId: 'actor-1', idFactory },
      'mock',
    );
    expect(role.isSystemDefault).toBe(false);
    expect(role.organizationId).toBe(DEFAULT_ORGANIZATION_ID);

    const permissions = await resolvePermissionKeysForRole(role.key, DEFAULT_ORGANIZATION_ID, 'mock');
    expect(permissions.has('case.read')).toBe(true);
    expect(permissions.has('case.create')).toBe(true);
    expect(permissions.has('case.delete')).toBe(false);

    const roles = await listRolesForOrganization(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(roles.some((r) => r.id === role.id)).toBe(true);

    const audit = await listAuditEntries(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(audit.some((e) => e.action === 'role_created' && e.roleId === role.id)).toBe(true);
  });
});

describe('cloneRole', () => {
  it('clones a platform default role into an independently editable custom role', async () => {
    const defaultRoles = await listRolesForOrganization(DEFAULT_ORGANIZATION_ID, 'mock');
    const officeStaff = defaultRoles.find((r) => r.key === 'officeStaff')!;

    const cloned = await cloneRole(
      { organizationId: DEFAULT_ORGANIZATION_ID, sourceRoleId: officeStaff.id, name: 'Office Staff (Extended)', actorIdentityId: 'actor-1', idFactory },
      'mock',
    );
    expect(cloned.isSystemDefault).toBe(false);
    expect(cloned.id).not.toBe(officeStaff.id);

    const clonedPermissions = await resolvePermissionKeysForRole(cloned.key, DEFAULT_ORGANIZATION_ID, 'mock');
    const originalPermissions = await resolvePermissionKeysForRole('officeStaff', DEFAULT_ORGANIZATION_ID, 'mock');
    expect([...clonedPermissions].sort()).toEqual([...originalPermissions].sort());
  });

  it('refuses to clone a role belonging to a different organization', async () => {
    const custom = await createCustomRole(
      { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Custom A', description: '', permissions: ['case.read'], actorIdentityId: 'actor-1', idFactory },
      'mock',
    );
    await expect(
      cloneRole({ organizationId: SECOND_MOCK_ORGANIZATION_ID, sourceRoleId: custom.id, name: 'Stolen Clone', actorIdentityId: 'actor-1', idFactory }, 'mock'),
    ).rejects.toThrow(RoleServiceError);
  });
});

describe('updateRole', () => {
  it('refuses to modify a platform-default role', async () => {
    const roles = await listRolesForOrganization(DEFAULT_ORGANIZATION_ID, 'mock');
    const administrator = roles.find((r) => r.key === 'administrator')!;
    await expect(updateRole({ roleId: administrator.id, name: 'Hacked', actorIdentityId: 'actor-1', idFactory }, 'mock')).rejects.toThrow(RoleServiceError);
  });

  it('renames a custom role and edits its permission set', async () => {
    const custom = await createCustomRole(
      { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Custom B', description: 'desc', permissions: ['case.read'], actorIdentityId: 'actor-1', idFactory },
      'mock',
    );

    const updated = await updateRole({ roleId: custom.id, name: 'Custom B Renamed', addPermissions: ['case.update'], removePermissions: ['case.read'], actorIdentityId: 'actor-1', idFactory }, 'mock');
    expect(updated.name).toBe('Custom B Renamed');

    const permissions = await resolvePermissionKeysForRole(custom.key, DEFAULT_ORGANIZATION_ID, 'mock');
    expect(permissions.has('case.update')).toBe(true);
    expect(permissions.has('case.read')).toBe(false);
  });

  it('fail-closed: refuses to remove organization.manage from an assigned custom role if it would strand the organization', async () => {
    const orgId = 'update-role-strand-org';
    await seedDefaultRoles(orgId, 'mock');
    const adminCustom = await createCustomRole(
      { organizationId: orgId, name: 'Sole Admin Role', description: '', permissions: ['organization.manage', 'case.read'], actorIdentityId: 'actor-1', idFactory },
      'mock',
    );
    pushMembership({ id: 'membership-sole-admin-custom', identityId: 'identity-sole-admin-custom', role: adminCustom.key, organizationId: orgId });

    await expect(
      updateRole({ roleId: adminCustom.id, removePermissions: ['organization.manage'], actorIdentityId: 'actor-1', idFactory }, 'mock'),
    ).rejects.toThrow(RoleServiceError);

    // The permission must still be granted — the update was refused
    // atomically, not partially applied.
    const permissions = await resolvePermissionKeysForRole(adminCustom.key, orgId, 'mock');
    expect(permissions.has('organization.manage')).toBe(true);
  });

  it('allows removing organization.manage from an assigned custom role when another administrator remains', async () => {
    const orgId = 'update-role-safe-org';
    await seedDefaultRoles(orgId, 'mock');
    const adminCustom = await createCustomRole(
      { organizationId: orgId, name: 'Admin Role', description: '', permissions: ['organization.manage', 'case.read'], actorIdentityId: 'actor-1', idFactory },
      'mock',
    );
    pushMembership({ id: 'membership-demoted-custom', identityId: 'identity-demoted-custom', role: adminCustom.key, organizationId: orgId });
    pushMembership({ id: 'membership-other-admin-custom', identityId: 'identity-other-admin-custom', role: 'administrator', organizationId: orgId });

    const updated = await updateRole({ roleId: adminCustom.id, removePermissions: ['organization.manage'], actorIdentityId: 'actor-1', idFactory }, 'mock');
    expect(updated).toBeTruthy();
    const permissions = await resolvePermissionKeysForRole(adminCustom.key, orgId, 'mock');
    expect(permissions.has('organization.manage')).toBe(false);
  });
});

describe('deleteRole', () => {
  it('refuses to delete a platform-default role', async () => {
    const roles = await listRolesForOrganization(DEFAULT_ORGANIZATION_ID, 'mock');
    const readOnly = roles.find((r) => r.key === 'readOnly')!;
    await expect(deleteRole({ roleId: readOnly.id, actorIdentityId: 'actor-1', idFactory }, 'mock')).rejects.toThrow(RoleServiceError);
  });

  it('refuses to delete a custom role currently assigned to an active member', async () => {
    const custom = await createCustomRole(
      { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Custom C', description: '', permissions: ['case.read'], actorIdentityId: 'actor-1', idFactory },
      'mock',
    );
    pushMembership({ id: 'membership-holds-custom', identityId: 'identity-holds-custom', role: custom.key });
    await expect(deleteRole({ roleId: custom.id, actorIdentityId: 'actor-1', idFactory }, 'mock')).rejects.toThrow(RoleServiceError);
  });

  it('deletes an unassigned custom role', async () => {
    const custom = await createCustomRole(
      { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Custom D', description: '', permissions: ['case.read'], actorIdentityId: 'actor-1', idFactory },
      'mock',
    );
    await deleteRole({ roleId: custom.id, actorIdentityId: 'actor-1', idFactory }, 'mock');
    const roles = await listRolesForOrganization(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(roles.some((r) => r.id === custom.id)).toBe(false);

    const audit = await listAuditEntries(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(audit.some((e) => e.action === 'role_deleted' && e.roleId === custom.id)).toBe(true);
  });
});

describe('assignRole / removeRole', () => {
  it('assigns a new role to a membership and records the previous role in the audit entry', async () => {
    const membership = pushMembership({ id: 'membership-assign-1', identityId: 'identity-assign-1', role: 'readOnly' });
    const { membership: updated, auditEntry } = await assignRole({ membership, roleKey: 'funeralDirector', actorIdentityId: 'actor-1', idFactory }, 'mock');
    expect(updated.role).toBe('funeralDirector');
    expect(auditEntry.action).toBe('role_assigned');
    expect(auditEntry.previousRoleKey).toBe('readOnly');
  });

  it('rejects assigning an unknown role key', async () => {
    const membership = pushMembership({ id: 'membership-assign-2', identityId: 'identity-assign-2', role: 'readOnly' });
    await expect(assignRole({ membership, roleKey: 'not-a-real-role', actorIdentityId: 'actor-1', idFactory }, 'mock')).rejects.toThrow(RoleServiceError);
  });

  it('refuses to change the last administrator away from admin-tier', async () => {
    const solo = await seedDefaultRoles('solo-admin-org', 'mock');
    expect(solo.enablements.length).toBe(7);
    const onlyAdmin = pushMembership({ id: 'membership-only-admin', identityId: 'identity-only-admin', role: 'administrator', organizationId: 'solo-admin-org' });
    await expect(assignRole({ membership: onlyAdmin, roleKey: 'readOnly', actorIdentityId: 'actor-1', idFactory }, 'mock')).rejects.toThrow(RoleServiceError);
  });

  it('allows demoting an administrator when another administrator remains', async () => {
    pushMembership({ id: 'membership-other-admin', identityId: 'identity-other-admin', role: 'administrator', organizationId: DEFAULT_ORGANIZATION_ID });
    const membership = await import('./membershipService').then((m) => m.getMembership(MANORS_ADMIN_IDENTITY_ID, DEFAULT_ORGANIZATION_ID, 'mock'));
    // Manor's seeded administrator plus the extra admin just pushed means demoting the seeded one is safe.
    expect(membership).not.toBeNull();
    const { membership: updated } = await assignRole({ membership: membership as Membership, roleKey: 'readOnly', actorIdentityId: 'actor-1', idFactory }, 'mock');
    expect(updated.role).toBe('readOnly');
  });

  it('removeRole falls back to readOnly and records a role_removed audit entry', async () => {
    const membership = pushMembership({ id: 'membership-remove-1', identityId: 'identity-remove-1', role: 'funeralDirector' });
    const { membership: updated, auditEntry } = await removeRole({ membership, actorIdentityId: 'actor-1', idFactory }, 'mock');
    expect(updated.role).toBe('readOnly');
    expect(auditEntry.action).toBe('role_removed');
    expect(auditEntry.previousRoleKey).toBe('funeralDirector');
  });

  describe('concurrency: the last-administrator invariant under simultaneous requests', () => {
    it('when two administrators simultaneously demote each other, exactly one succeeds and the organization retains one active administrator', async () => {
      const orgId = 'concurrent-strand-org';
      await seedDefaultRoles(orgId, 'mock');
      const adminA = pushMembership({ id: 'membership-concurrent-a', identityId: 'identity-concurrent-a', role: 'administrator', organizationId: orgId });
      const adminB = pushMembership({ id: 'membership-concurrent-b', identityId: 'identity-concurrent-b', role: 'administrator', organizationId: orgId });

      // Two "simultaneous" requests: A demotes B, B demotes A — issued at
      // once via Promise.allSettled. Without the organization-scoped lock
      // (or with only a read-before-write check outside it), both could
      // observe "the other administrator is still active" before either
      // write lands, and both succeed — leaving zero administrators.
      const [resultForB, resultForA] = await Promise.allSettled([
        assignRole({ membership: adminB, roleKey: 'readOnly', actorIdentityId: adminA.identityId, idFactory }, 'mock'),
        assignRole({ membership: adminA, roleKey: 'readOnly', actorIdentityId: adminB.identityId, idFactory }, 'mock'),
      ]);

      const outcomes = [resultForB, resultForA];
      const fulfilled = outcomes.filter((r) => r.status === 'fulfilled');
      const rejected = outcomes.filter((r) => r.status === 'rejected');

      // Exactly one mutation may succeed.
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(RoleServiceError);

      // The organization must retain exactly one active administrator —
      // never zero, never (nonsensically) both still admins.
      const { listMembershipsForOrganization, isActiveMembership } = await import('./membershipService');
      const { isAdminTier } = await import('./authorizationPolicyService');
      const activeMemberships = (await listMembershipsForOrganization(orgId, 'mock')).filter(isActiveMembership);
      const adminChecks = await Promise.all(
        activeMemberships.map((m) => isAdminTier({ identityId: m.identityId, organizationId: orgId, roleKey: m.role }, 'mock')),
      );
      expect(adminChecks.filter(Boolean).length).toBe(1);
    });
  });
});

describe('setMembershipStatus', () => {
  it('disables a non-administrator membership without issue', async () => {
    const membership = pushMembership({ id: 'membership-disable-1', identityId: 'identity-disable-1', role: 'readOnly' });
    const { membership: updated, auditEntry } = await setMembershipStatus({ membership, status: 'disabled', actorIdentityId: 'actor-1', idFactory }, 'mock');
    expect(updated.status).toBe('disabled');
    expect(auditEntry?.action).toBe('membership_disabled');
  });

  it('refuses to disable the last active administrator', async () => {
    const orgId = 'disable-last-admin-org';
    await seedDefaultRoles(orgId, 'mock');
    const onlyAdmin = pushMembership({ id: 'membership-disable-only-admin', identityId: 'identity-disable-only-admin', role: 'administrator', organizationId: orgId });
    await expect(setMembershipStatus({ membership: onlyAdmin, status: 'disabled', actorIdentityId: 'actor-1', idFactory }, 'mock')).rejects.toThrow(RoleServiceError);
  });

  it('allows disabling an administrator when another remains', async () => {
    const orgId = 'disable-admin-safe-org';
    await seedDefaultRoles(orgId, 'mock');
    const admin1 = pushMembership({ id: 'membership-disable-admin-1', identityId: 'identity-disable-admin-1', role: 'administrator', organizationId: orgId });
    pushMembership({ id: 'membership-disable-admin-2', identityId: 'identity-disable-admin-2', role: 'administrator', organizationId: orgId });
    const { membership: updated } = await setMembershipStatus({ membership: admin1, status: 'disabled', actorIdentityId: 'actor-1', idFactory }, 'mock');
    expect(updated.status).toBe('disabled');
  });

  describe('Phase 23: reactivation, idempotency, and the removed/invited terminal states', () => {
    it('reactivating a disabled membership records a membership_reactivated audit entry (previously recorded none)', async () => {
      const membership = pushMembership({ id: 'membership-reactivate-1', identityId: 'identity-reactivate-1', role: 'readOnly', status: 'disabled' });
      const { membership: updated, auditEntry } = await setMembershipStatus({ membership, status: 'active', actorIdentityId: 'actor-1', idFactory }, 'mock');
      expect(updated.status).toBe('active');
      expect(auditEntry?.action).toBe('membership_reactivated');
    });

    it('is an idempotent no-op when already in the requested status — no duplicate audit entry', async () => {
      const membership = pushMembership({ id: 'membership-noop-1', identityId: 'identity-noop-1', role: 'readOnly', status: 'disabled' });
      const before = (await listAuditEntries(DEFAULT_ORGANIZATION_ID, 'mock')).length;
      const { membership: updated, auditEntry } = await setMembershipStatus({ membership, status: 'disabled', actorIdentityId: 'actor-1', idFactory }, 'mock');
      expect(updated.status).toBe('disabled');
      expect(auditEntry).toBeNull();
      expect((await listAuditEntries(DEFAULT_ORGANIZATION_ID, 'mock')).length).toBe(before);
    });

    it("'removed' is terminal — reactivating or disabling a removed membership is refused, not silently reapplied", async () => {
      const membership = pushMembership({ id: 'membership-removed-terminal-1', identityId: 'identity-removed-terminal-1', role: 'readOnly', status: 'removed' });
      await expect(setMembershipStatus({ membership, status: 'active', actorIdentityId: 'actor-1', idFactory }, 'mock')).rejects.toThrow(RoleServiceError);
      await expect(setMembershipStatus({ membership, status: 'disabled', actorIdentityId: 'actor-1', idFactory }, 'mock')).rejects.toThrow(RoleServiceError);
    });

    it('removing a removed membership again is an idempotent no-op', async () => {
      const membership = pushMembership({ id: 'membership-removed-noop-1', identityId: 'identity-removed-noop-1', role: 'readOnly', status: 'removed' });
      const { membership: updated, auditEntry } = await setMembershipStatus({ membership, status: 'removed', actorIdentityId: 'actor-1', idFactory }, 'mock');
      expect(updated.status).toBe('removed');
      expect(auditEntry).toBeNull();
    });

    it('refuses to act on a pending invitation — directs the caller to revokeInvitation instead', async () => {
      const membership = pushMembership({ id: 'membership-invited-1', identityId: 'identity-invited-1', role: 'readOnly', status: 'invited' });
      await expect(setMembershipStatus({ membership, status: 'disabled', actorIdentityId: 'actor-1', idFactory }, 'mock')).rejects.toThrow(RoleServiceError);
    });
  });
});

describe('stale-writer rejection — the third security-correction round', () => {
  /**
   * Runs the exact adversarial sequence specified for this correction
   * round against a real lock handle: holder A acquires the lease and
   * passes its final fence check, is paused *before* its protected write
   * (the second round's vulnerable "check, then later, separately, write"
   * pattern), the lease is force-expired, holder B genuinely reclaims it
   * and completes its own protected write, then A resumes and attempts
   * its own now-stale protected write via `commitProtectedWrite` — the
   * exact function every guarded mutation in this file routes its actual
   * persistence calls through. Returns whatever A's attempt threw, so
   * each test below can assert both the specific rejection and that A's
   * write produced no state change.
   */
  async function runStaleWriteScenario(orgId: string, aWrite: () => Promise<unknown>, bWrite: () => Promise<unknown>): Promise<unknown> {
    let resumeA!: () => void;
    const pauseA = new Promise<void>((resolve) => {
      resumeA = resolve;
    });

    const aPromise = withOrganizationRoleLock(orgId, 'mock', async (handleA) => {
      await assertFenceStillCurrent(handleA, 'mock'); // (1) A's final fence check — passes
      await pauseA; // (2) pause A before its protected write
      return commitProtectedWrite(handleA, 'mock', aWrite); // (6) resumed — A's stale write attempt
    });

    await sleep(20); // let A's callback reach and pass its fence check

    // (3) force A's lease to expire.
    const lockIndex = organizationRoleLockFixtures.findIndex((l) => l.organizationId === orgId);
    organizationRoleLockFixtures[lockIndex] = { ...organizationRoleLockFixtures[lockIndex], expiresAt: new Date(Date.now() - 1_000).toISOString() };

    // (4) B reclaims the lease and advances the fence; (5) B performs its
    // own protected mutation.
    await withOrganizationRoleLock(orgId, 'mock', async (handleB) => commitProtectedWrite(handleB, 'mock', bWrite));

    resumeA();
    let caught: unknown;
    try {
      await aPromise;
    } catch (error) {
      caught = error;
    }
    return caught;
  }

  it('a stale role-assignment write is rejected with no state change', async () => {
    const orgId = 'stale-role-assignment-org';
    await seedDefaultRoles(orgId, 'mock');
    const membership = pushMembership({ id: 'membership-stale-assign', identityId: 'identity-stale-assign', role: 'readOnly', organizationId: orgId });

    const error = await runStaleWriteScenario(
      orgId,
      () => updateMembership(membership.id, { role: 'administrator' }, 'mock'), // A's stale assignment attempt
      () => updateMembership(membership.id, { role: 'funeralDirector' }, 'mock'), // B's genuine, successful assignment
    );

    expect(error).toBeInstanceOf(LockLeaseLostError);
    const current = membershipFixtures.find((m) => m.id === membership.id);
    expect(current?.role).toBe('funeralDirector'); // B's write stands; A's stale write never applied
  });

  it('a stale membership-status write is rejected with no state change', async () => {
    const orgId = 'stale-membership-status-org';
    await seedDefaultRoles(orgId, 'mock');
    const membership = pushMembership({ id: 'membership-stale-status', identityId: 'identity-stale-status', role: 'readOnly', organizationId: orgId });

    const error = await runStaleWriteScenario(
      orgId,
      () => updateMembership(membership.id, { status: 'removed' }, 'mock'), // A's stale status attempt
      () => updateMembership(membership.id, { status: 'disabled' }, 'mock'), // B's genuine, successful status change
    );

    expect(error).toBeInstanceOf(LockLeaseLostError);
    const current = membershipFixtures.find((m) => m.id === membership.id);
    expect(current?.status).toBe('disabled'); // B's write stands; A's stale write never applied
  });

  it('a stale custom-role permission update is rejected with no state change', async () => {
    const orgId = 'stale-role-permission-org';
    await seedDefaultRoles(orgId, 'mock');
    const custom = await createCustomRole(
      { organizationId: orgId, name: 'Stale Target Role', description: '', permissions: ['case.read'], actorIdentityId: 'actor-1', idFactory },
      'mock',
    );

    const error = await runStaleWriteScenario(
      orgId,
      async () => {
        rolePermissionFixtures.push({ id: 'stale-a-grant', roleId: custom.id, permissionKey: 'case.update', createdAt: new Date().toISOString() });
      },
      async () => {
        rolePermissionFixtures.push({ id: 'genuine-b-grant', roleId: custom.id, permissionKey: 'organization.manage', createdAt: new Date().toISOString() });
      },
    );

    expect(error).toBeInstanceOf(LockLeaseLostError);
    const grants = rolePermissionFixtures.filter((rp) => rp.roleId === custom.id);
    expect(grants.some((rp) => rp.permissionKey === 'organization.manage')).toBe(true); // B's grant stands
    expect(grants.some((rp) => rp.permissionKey === 'case.update')).toBe(false); // A's stale grant never applied
  });

  it('a stale role-deletion write is rejected with no state change', async () => {
    const orgId = 'stale-role-deletion-org';
    await seedDefaultRoles(orgId, 'mock');
    const target = await createCustomRole(
      { organizationId: orgId, name: 'Stale Deletion Target', description: '', permissions: ['case.read'], actorIdentityId: 'actor-1', idFactory },
      'mock',
    );
    const unrelated = await createCustomRole(
      { organizationId: orgId, name: 'Unrelated Role', description: '', permissions: ['case.read'], actorIdentityId: 'actor-1', idFactory },
      'mock',
    );

    const error = await runStaleWriteScenario(
      orgId,
      async () => {
        const index = roleFixtures.findIndex((r) => r.id === target.id);
        if (index !== -1) roleFixtures.splice(index, 1); // A's stale deletion attempt
      },
      async () => {
        // B's genuine, successful deletion — of the *unrelated* role.
        const roleIndex = roleFixtures.findIndex((r) => r.id === unrelated.id);
        if (roleIndex !== -1) roleFixtures.splice(roleIndex, 1);
        const enablementIndex = organizationRoleFixtures.findIndex((e) => e.organizationId === orgId && e.roleId === unrelated.id);
        if (enablementIndex !== -1) organizationRoleFixtures.splice(enablementIndex, 1);
      },
    );

    expect(error).toBeInstanceOf(LockLeaseLostError);
    expect(roleFixtures.some((r) => r.id === target.id)).toBe(true); // A's stale deletion never applied
    expect(roleFixtures.some((r) => r.id === unrelated.id)).toBe(false); // B's genuine deletion stands
  });
});

describe('fail-closed permission resolution for missing/foreign/malformed roles', () => {
  it('a membership referencing a role key that no longer resolves gets zero permissions, never a fallback set', async () => {
    const permissions = await resolvePermissionKeysForRole('role-that-was-deleted', DEFAULT_ORGANIZATION_ID, 'mock');
    expect(permissions.size).toBe(0);
  });

  it("a membership referencing another organization's custom role gets zero permissions", async () => {
    const custom = await createCustomRole(
      { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Foreign Custom', description: '', permissions: ['organization.manage', 'case.read'], actorIdentityId: 'actor-1', idFactory },
      'mock',
    );
    const permissionsFromOwnOrg = await resolvePermissionKeysForRole(custom.key, DEFAULT_ORGANIZATION_ID, 'mock');
    expect(permissionsFromOwnOrg.has('organization.manage')).toBe(true);

    const permissionsFromForeignOrg = await resolvePermissionKeysForRole(custom.key, SECOND_MOCK_ORGANIZATION_ID, 'mock');
    expect(permissionsFromForeignOrg.size).toBe(0);
  });

  it('malformed or unknown legacy role values resolve to zero permissions, never elevated/default access', async () => {
    for (const bogus of ['', '   ', 'DROP TABLE roles;', 'null', 'undefined', '../../etc/passwd']) {
      const permissions = await resolvePermissionKeysForRole(bogus, DEFAULT_ORGANIZATION_ID, 'mock');
      expect(permissions.size).toBe(0);
    }
  });
});

describe('listOrganizationRoleEnablements / cross-tenant isolation', () => {
  it("does not include another organization's enablements", async () => {
    await seedDefaultRoles('isolated-org', 'mock');
    const enablements = await listOrganizationRoleEnablements(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(enablements.every((e) => e.organizationId === DEFAULT_ORGANIZATION_ID)).toBe(true);
  });
});
