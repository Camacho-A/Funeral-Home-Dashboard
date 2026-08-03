import { describe, it, expect } from 'vitest';
import { resolveRoleForKey, resolvePermissionKeysForRole, resolvePermissions, hasPermission, hasAnyPermission, hasAllPermissions } from './permissionService';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';

const OTHER_ORG = 'some-other-organization';

describe('permissionService', () => {
  describe('resolveRoleForKey', () => {
    it('resolves a Phase 22 default role key', async () => {
      const role = await resolveRoleForKey('administrator', DEFAULT_ORGANIZATION_ID, 'mock');
      expect(role?.key).toBe('administrator');
      expect(role?.isSystemDefault).toBe(true);
    });

    it('resolves a legacy MembershipRole/OrganizationRole value via alias', async () => {
      const owner = await resolveRoleForKey('owner', DEFAULT_ORGANIZATION_ID, 'mock');
      const admin = await resolveRoleForKey('administrator', DEFAULT_ORGANIZATION_ID, 'mock');
      expect(owner?.id).toBe(admin?.id);

      const caseManager = await resolveRoleForKey('caseManager', DEFAULT_ORGANIZATION_ID, 'mock');
      expect(caseManager?.key).toBe('funeralDirector');

      const staff = await resolveRoleForKey('staff', DEFAULT_ORGANIZATION_ID, 'mock');
      expect(staff?.key).toBe('officeStaff');
    });

    it('returns null for an unknown role key', async () => {
      const role = await resolveRoleForKey('not-a-real-role', DEFAULT_ORGANIZATION_ID, 'mock');
      expect(role).toBeNull();
    });

    it('resolves a platform-default role identically regardless of requesting organization', async () => {
      const forDefault = await resolveRoleForKey('administrator', DEFAULT_ORGANIZATION_ID, 'mock');
      const forOther = await resolveRoleForKey('administrator', OTHER_ORG, 'mock');
      expect(forDefault?.id).toBe(forOther?.id);
    });
  });

  describe('resolvePermissionKeysForRole', () => {
    it('resolves the administrator role to every permission', async () => {
      const permissions = await resolvePermissionKeysForRole('administrator', DEFAULT_ORGANIZATION_ID, 'mock');
      expect(permissions.has('organization.manage')).toBe(true);
      expect(permissions.has('case.delete')).toBe(true);
      expect(permissions.size).toBe(32); // Phase 26: 28 + signature.request + signature.read + signature.cancel + signature.manage
    });

    it('resolves readOnly to only read/view permissions', async () => {
      const permissions = await resolvePermissionKeysForRole('readOnly', DEFAULT_ORGANIZATION_ID, 'mock');
      expect(permissions.has('case.read')).toBe(true);
      expect(permissions.has('case.update')).toBe(false);
      expect(permissions.has('organization.manage')).toBe(false);
    });

    it('returns an empty set for an unresolvable role — fail-closed, never a fallback permission set', async () => {
      const permissions = await resolvePermissionKeysForRole('bogus', DEFAULT_ORGANIZATION_ID, 'mock');
      expect(permissions.size).toBe(0);
    });
  });

  describe('resolvePermissions / hasPermission / hasAnyPermission / hasAllPermissions', () => {
    const params = { identityId: 'identity-1', organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'funeralDirector' };

    it('resolves a permission set', async () => {
      const permissions = await resolvePermissions(params, 'mock');
      expect(permissions.has('case.read')).toBe(true);
    });

    it('hasPermission reflects the resolved set', async () => {
      expect(await hasPermission(params, 'mock', 'case.read')).toBe(true);
      expect(await hasPermission(params, 'mock', 'organization.manage')).toBe(false);
    });

    it('hasAnyPermission is true if at least one matches', async () => {
      expect(await hasAnyPermission(params, 'mock', ['organization.manage', 'case.read'])).toBe(true);
      expect(await hasAnyPermission(params, 'mock', ['organization.manage', 'settings.manage'])).toBe(false);
    });

    it('hasAllPermissions requires every one to match', async () => {
      expect(await hasAllPermissions(params, 'mock', ['case.read', 'case.create'])).toBe(true);
      expect(await hasAllPermissions(params, 'mock', ['case.read', 'organization.manage'])).toBe(false);
    });
  });

  describe('no cross-request caching — a role change takes effect on the very next resolution', () => {
    it('resolvePermissions never returns a stale set from an earlier call for the same identity+organization', async () => {
      const identityId = 'identity-no-cache-check';

      // First "request": resolve under readOnly.
      const before = await resolvePermissions({ identityId, organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly' }, 'mock');
      expect(before.has('case.update')).toBe(false);

      // A role change happens (e.g. via RoleService.assignRole, on this
      // instance or, in a real deployment, a completely different one) —
      // simulated here simply by resolving a different role for the same
      // identity+organization pair, exactly as a fresh authorization check
      // on any instance would after the membership row itself changed.
      const after = await resolvePermissions({ identityId, organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'funeralDirector' }, 'mock');
      expect(after.has('case.update')).toBe(true);

      // And resolving the identity's original role again still reflects
      // that role's own permissions — nothing was mutated or cross-
      // contaminated by the intervening call.
      const again = await resolvePermissions({ identityId, organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly' }, 'mock');
      expect(again.has('case.update')).toBe(false);
    });

    it('hasPermission reflects a role change immediately, with no separate invalidation step required', async () => {
      const identityId = 'identity-no-cache-check-2';
      expect(await hasPermission({ identityId, organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'readOnly' }, 'mock', 'organization.manage')).toBe(false);
      expect(await hasPermission({ identityId, organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'administrator' }, 'mock', 'organization.manage')).toBe(true);
    });
  });
});
