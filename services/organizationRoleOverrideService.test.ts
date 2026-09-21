import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  listOverridesForOrganization,
  getOverridesForRole,
  upsertOverride,
  removeOverride,
  removeOverrideById,
  RoleOverrideServiceError,
} from './organizationRoleOverrideService';
import { listAuditEntries } from './roleService';
import { resolvePermissionKeysForRole } from './permissionService';
import { organizationRolePermissionOverrideFixtures, organizationRoleAuditEntryFixtures } from './__mocks__/rbacFixtures';
import { membershipFixtures } from './__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { Membership } from '../types/membership';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `override-test-${idCounter}`;
}

let overrideSnapshot: typeof organizationRolePermissionOverrideFixtures;
let auditSnapshot: typeof organizationRoleAuditEntryFixtures;
let membershipSnapshot: Membership[];
beforeEach(() => {
  idCounter = 0;
  overrideSnapshot = organizationRolePermissionOverrideFixtures.map((o) => ({ ...o }));
  auditSnapshot = organizationRoleAuditEntryFixtures.map((a) => ({ ...a }));
  membershipSnapshot = membershipFixtures.map((m) => ({ ...m }));
});
afterEach(() => {
  organizationRolePermissionOverrideFixtures.length = 0;
  organizationRolePermissionOverrideFixtures.push(...overrideSnapshot);
  organizationRoleAuditEntryFixtures.length = 0;
  organizationRoleAuditEntryFixtures.push(...auditSnapshot);
  membershipFixtures.length = 0;
  membershipFixtures.push(...membershipSnapshot);
});

describe('upsertOverride — validation', () => {
  it('rejects an unknown role key', async () => {
    await expect(
      upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'not-a-real-role', permissionKey: 'ap.read', action: 'revoke', actorIdentityId: 'actor-1', idFactory }, 'mock'),
    ).rejects.toThrow(RoleOverrideServiceError);
  });

  it('rejects a custom-role-shaped key (not supported in this implementation)', async () => {
    await expect(
      upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'custom_abc123', permissionKey: 'ap.read', action: 'revoke', actorIdentityId: 'actor-1', idFactory }, 'mock'),
    ).rejects.toThrow(RoleOverrideServiceError);
  });

  it('rejects an unknown permission key', async () => {
    await expect(
      upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'officeStaff', permissionKey: 'not.a.real.permission', action: 'revoke', actorIdentityId: 'actor-1', idFactory }, 'mock'),
    ).rejects.toThrow(RoleOverrideServiceError);
  });

  it('rejects an invalid action', async () => {
    await expect(
      upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'officeStaff', permissionKey: 'ap.read', action: 'deny', actorIdentityId: 'actor-1', idFactory }, 'mock'),
    ).rejects.toThrow(RoleOverrideServiceError);
  });
});

describe('upsertOverride / getOverridesForRole — effective resolution', () => {
  it('a grant override adds a permission the base role does not have', async () => {
    const before = await resolvePermissionKeysForRole('readOnly', DEFAULT_ORGANIZATION_ID, 'mock');
    expect(before.has('signature.request')).toBe(false);

    await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'signature.request', action: 'grant', actorIdentityId: 'actor-1', idFactory }, 'mock');

    const after = await resolvePermissionKeysForRole('readOnly', DEFAULT_ORGANIZATION_ID, 'mock');
    expect(after.has('signature.request')).toBe(true);
  });

  it('a revoke override removes a permission the base role has', async () => {
    const before = await resolvePermissionKeysForRole('officeStaff', DEFAULT_ORGANIZATION_ID, 'mock');
    expect(before.has('caseOrder.update')).toBe(true);

    await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'officeStaff', permissionKey: 'caseOrder.update', action: 'revoke', actorIdentityId: 'actor-1', idFactory }, 'mock');

    const after = await resolvePermissionKeysForRole('officeStaff', DEFAULT_ORGANIZATION_ID, 'mock');
    expect(after.has('caseOrder.update')).toBe(false);
  });

  it('an override for Org A does not affect Org B', async () => {
    await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'officeStaff', permissionKey: 'caseOrder.update', action: 'revoke', actorIdentityId: 'actor-1', idFactory }, 'mock');

    const orgAResult = await resolvePermissionKeysForRole('officeStaff', DEFAULT_ORGANIZATION_ID, 'mock');
    const orgBResult = await resolvePermissionKeysForRole('officeStaff', SECOND_MOCK_ORGANIZATION_ID, 'mock');
    expect(orgAResult.has('caseOrder.update')).toBe(false);
    expect(orgBResult.has('caseOrder.update')).toBe(true);
  });

  it('an override for Office Staff does not affect Manager', async () => {
    // settings.manage is in neither role's base set, so granting it to
    // Office Staff only is an unambiguous, one-directional check.
    await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'officeStaff', permissionKey: 'settings.manage', action: 'grant', actorIdentityId: 'actor-1', idFactory }, 'mock');

    const officeStaffResult = await resolvePermissionKeysForRole('officeStaff', DEFAULT_ORGANIZATION_ID, 'mock');
    const managerResult = await resolvePermissionKeysForRole('manager', DEFAULT_ORGANIZATION_ID, 'mock');
    expect(officeStaffResult.has('settings.manage')).toBe(true);
    expect(managerResult.has('settings.manage')).toBe(false);
  });

  it('future/base role permissions continue to flow through unless explicitly revoked', async () => {
    // officeStaff's base already includes case.create/case.read/case.update — none revoked.
    await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'officeStaff', permissionKey: 'ap.read', action: 'grant', actorIdentityId: 'actor-1', idFactory }, 'mock');
    const effective = await resolvePermissionKeysForRole('officeStaff', DEFAULT_ORGANIZATION_ID, 'mock');
    expect(effective.has('case.create')).toBe(true);
    expect(effective.has('case.read')).toBe(true);
    expect(effective.has('case.update')).toBe(true);
    expect(effective.has('caseOrder.update')).toBe(true);
  });

  it('duplicate logical overrides cannot accumulate — a second upsert for the same tuple updates the one row', async () => {
    await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'grant', actorIdentityId: 'actor-1', idFactory, reason: 'first' }, 'mock');
    await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'grant', actorIdentityId: 'actor-1', idFactory, reason: 'second' }, 'mock');

    const rows = await getOverridesForRole(DEFAULT_ORGANIZATION_ID, 'readOnly', 'mock');
    const matching = rows.filter((r) => r.permissionKey === 'ap.read');
    expect(matching).toHaveLength(1);
    expect(matching[0].reason).toBe('second');
  });

  it('flipping action (grant → revoke) for the same tuple replaces the row rather than adding a second one', async () => {
    await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'grant', actorIdentityId: 'actor-1', idFactory }, 'mock');
    await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'revoke', actorIdentityId: 'actor-1', idFactory }, 'mock');

    const rows = await getOverridesForRole(DEFAULT_ORGANIZATION_ID, 'readOnly', 'mock');
    expect(rows.filter((r) => r.permissionKey === 'ap.read')).toHaveLength(1);
    expect(rows.find((r) => r.permissionKey === 'ap.read')?.action).toBe('revoke');

    const effective = await resolvePermissionKeysForRole('readOnly', DEFAULT_ORGANIZATION_ID, 'mock');
    expect(effective.has('ap.read')).toBe(false);
  });

  it('removing an override restores base behavior', async () => {
    await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'officeStaff', permissionKey: 'caseOrder.update', action: 'revoke', actorIdentityId: 'actor-1', idFactory }, 'mock');
    expect((await resolvePermissionKeysForRole('officeStaff', DEFAULT_ORGANIZATION_ID, 'mock')).has('caseOrder.update')).toBe(false);

    await removeOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'officeStaff', permissionKey: 'caseOrder.update', actorIdentityId: 'actor-1', idFactory }, 'mock');
    expect((await resolvePermissionKeysForRole('officeStaff', DEFAULT_ORGANIZATION_ID, 'mock')).has('caseOrder.update')).toBe(true);
  });

  it('removeOverrideById removes by id and re-derives role/permission from the row', async () => {
    const created = await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'grant', actorIdentityId: 'actor-1', idFactory }, 'mock');
    await removeOverrideById({ organizationId: DEFAULT_ORGANIZATION_ID, overrideId: created.id, actorIdentityId: 'actor-1', idFactory }, 'mock');
    expect((await getOverridesForRole(DEFAULT_ORGANIZATION_ID, 'readOnly', 'mock')).some((o) => o.id === created.id)).toBe(false);
  });

  it('removeOverrideById is a safe no-op for an override belonging to a different organization', async () => {
    const created = await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'grant', actorIdentityId: 'actor-1', idFactory }, 'mock');
    await removeOverrideById({ organizationId: SECOND_MOCK_ORGANIZATION_ID, overrideId: created.id, actorIdentityId: 'attacker', idFactory }, 'mock');
    // Untouched — still present for its real organization.
    expect((await getOverridesForRole(DEFAULT_ORGANIZATION_ID, 'readOnly', 'mock')).some((o) => o.id === created.id)).toBe(true);
  });
});

describe('upsertOverride — admin-invariant protection', () => {
  it('refuses a revoke of organization.manage from administrator that would strand the organization', async () => {
    // DEFAULT_ORGANIZATION_ID's seeded memberships include exactly one
    // active administrator-tier member and no other admin-tier role —
    // revoking organization.manage from administrator itself would leave
    // zero.
    await expect(
      upsertOverride(
        { organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'administrator', permissionKey: 'organization.manage', action: 'revoke', actorIdentityId: 'actor-1', idFactory },
        'mock',
      ),
    ).rejects.toThrow('leave the organization with no administrator');
  });

  it('allows a revoke of organization.manage from a role no active member currently holds', async () => {
    // No active membership resolves to 'dispatch' with organization.manage
    // in the first place (dispatch never had it) — revoking a permission
    // it never held is a safe no-op with respect to the admin invariant.
    await expect(
      upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'dispatch', permissionKey: 'pickup.read', action: 'revoke', actorIdentityId: 'actor-1', idFactory }, 'mock'),
    ).resolves.toBeTruthy();
  });
});

describe('audit trail', () => {
  it('records override_granted with the authenticated actor, organization, role, and permission', async () => {
    await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'grant', actorIdentityId: 'identity-actor-42', idFactory }, 'mock');
    const entries = await listAuditEntries(DEFAULT_ORGANIZATION_ID, 'mock');
    const entry = entries.find((e) => e.action === 'override_granted' && e.permissionKey === 'ap.read');
    expect(entry).toBeDefined();
    expect(entry?.actorIdentityId).toBe('identity-actor-42');
    expect(entry?.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
  });

  it('records override_revoked when flipping to a revoke', async () => {
    await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'grant', actorIdentityId: 'actor-1', idFactory }, 'mock');
    await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'revoke', actorIdentityId: 'actor-2', idFactory }, 'mock');
    const entries = await listAuditEntries(DEFAULT_ORGANIZATION_ID, 'mock');
    const entry = entries.find((e) => e.action === 'override_revoked' && e.permissionKey === 'ap.read');
    expect(entry?.actorIdentityId).toBe('actor-2');
  });

  it('records override_removed on deletion', async () => {
    await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'grant', actorIdentityId: 'actor-1', idFactory }, 'mock');
    await removeOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', actorIdentityId: 'actor-3', idFactory }, 'mock');
    const entries = await listAuditEntries(DEFAULT_ORGANIZATION_ID, 'mock');
    const entry = entries.find((e) => e.action === 'override_removed' && e.permissionKey === 'ap.read');
    expect(entry?.actorIdentityId).toBe('actor-3');
  });
});

describe('listOverridesForOrganization', () => {
  it('lists every override for one organization, scoped correctly', async () => {
    await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'grant', actorIdentityId: 'actor-1', idFactory }, 'mock');
    await upsertOverride({ organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'officeStaff', permissionKey: 'ap.read', action: 'grant', actorIdentityId: 'actor-1', idFactory }, 'mock');
    await upsertOverride({ organizationId: SECOND_MOCK_ORGANIZATION_ID, roleKey: 'readOnly', permissionKey: 'ap.read', action: 'grant', actorIdentityId: 'actor-1', idFactory }, 'mock');

    const orgAOverrides = await listOverridesForOrganization(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(orgAOverrides).toHaveLength(2);
    expect(orgAOverrides.every((o) => o.organizationId === DEFAULT_ORGANIZATION_ID)).toBe(true);
  });
});
