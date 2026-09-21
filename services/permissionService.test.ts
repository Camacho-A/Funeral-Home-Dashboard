import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { resolveRoleForKey, resolvePermissionKeysForRole, resolvePermissions, hasPermission, hasAnyPermission, hasAllPermissions } from './permissionService';
import { resolveEnabledRoleForKey } from './roleService';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { PERMISSION_KEYS } from '../domain/rbac/permissionCatalog';

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

    it('Manors role-model correction (2026-09): still resolves Arranger for Manors — enablement-agnostic by design, so read-only permission resolution for an existing membership never breaks even if this organization never enabled the role', async () => {
      const role = await resolveRoleForKey('arranger', DEFAULT_ORGANIZATION_ID, 'mock');
      expect(role?.key).toBe('arranger');
    });
  });

  describe('resolveEnabledRoleForKey (Manors role-model correction, 2026-09) — the assignment-time gate resolveRoleForKey deliberately is not', () => {
    it('resolves a role Manors has actually enabled', async () => {
      const role = await resolveEnabledRoleForKey('administrator', DEFAULT_ORGANIZATION_ID, 'mock');
      expect(role?.key).toBe('administrator');
    });

    it('resolves the newly-required Accounting role for Manors', async () => {
      const role = await resolveEnabledRoleForKey('accounting', DEFAULT_ORGANIZATION_ID, 'mock');
      expect(role?.key).toBe('accounting');
    });

    it('returns null for Arranger — a real platform role, but never enabled for Manors', async () => {
      const role = await resolveEnabledRoleForKey('arranger', DEFAULT_ORGANIZATION_ID, 'mock');
      expect(role).toBeNull();
    });

    it('Arranger remains fully available platform-wide for a different organization that has enabled it', async () => {
      const { seedDefaultRoles } = await import('./roleService');
      const otherOrgId = 'org-that-uses-arranger';
      await seedDefaultRoles(otherOrgId, 'mock');
      const role = await resolveEnabledRoleForKey('arranger', otherOrgId, 'mock');
      expect(role?.key).toBe('arranger');
    });

    it('returns null for an unknown role key, same as resolveRoleForKey', async () => {
      expect(await resolveEnabledRoleForKey('not-a-real-role', DEFAULT_ORGANIZATION_ID, 'mock')).toBeNull();
    });
  });

  describe('resolvePermissionKeysForRole', () => {
    it('resolves the administrator role to every permission', async () => {
      const permissions = await resolvePermissionKeysForRole('administrator', DEFAULT_ORGANIZATION_ID, 'mock');
      expect(permissions.has('organization.manage')).toBe(true);
      expect(permissions.has('case.delete')).toBe(true);
      expect(permissions.size).toBe(68); // Manors launch-prep: 64 + pickup.read/pickup.update; Manors go-live fix: + case.reassign; Manors go-live hardening: + user.read
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

  describe('wix mode — pagination fix (Manors go-live incident, 2026-09)', () => {
    let originalApiKey: string | undefined;
    let originalSiteId: string | undefined;

    beforeEach(() => {
      originalApiKey = process.env.WIX_API_KEY;
      originalSiteId = process.env.WIX_SITE_ID;
      process.env.WIX_API_KEY = 'test-key-value';
      process.env.WIX_SITE_ID = 'test-site-id';
    });

    afterEach(() => {
      if (originalApiKey === undefined) delete process.env.WIX_API_KEY;
      else process.env.WIX_API_KEY = originalApiKey;
      if (originalSiteId === undefined) delete process.env.WIX_SITE_ID;
      else process.env.WIX_SITE_ID = originalSiteId;
      vi.unstubAllGlobals();
    });

    /** Builds a fetch stub that answers exactly the three query shapes
        `resolvePermissionKeysForRole` issues in wix mode: the role lookup,
        the (now paginated) rolePermissions read, and the organization
        override read. `grantPages` lets a test split the role's grants
        across more than one page, exactly mirroring what Wix Data itself
        does once a role passes 50 grants. */
    function stubWixRbacFetch(options: {
      roleKey: string;
      grantPages: string[][];
      overrides?: Array<{ permissionKey: string; action: 'grant' | 'revoke' }>;
    }) {
      const roleId = `role-${options.roleKey}`;
      const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body);
        const { dataCollectionId, query } = body;

        if (dataCollectionId === 'roles') {
          return {
            ok: true,
            json: async () => ({
              dataItems: [
                {
                  id: roleId,
                  dataCollectionId: 'roles',
                  data: {
                    beaconRoleId: roleId,
                    key: options.roleKey,
                    name: options.roleKey,
                    description: 'test role',
                    organizationId: null,
                    isSystemDefault: true,
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                  },
                },
              ],
            }),
          };
        }

        if (dataCollectionId === 'rolePermissions') {
          const pageIndex = query.paging?.cursor ? Number(query.paging.cursor.replace('page-', '')) : 0;
          const permissionKeys = options.grantPages[pageIndex] ?? [];
          const hasNext = pageIndex + 1 < options.grantPages.length;
          return {
            ok: true,
            json: async () => ({
              dataItems: permissionKeys.map((permissionKey, i) => ({
                id: `${roleId}-${pageIndex}-${i}`,
                dataCollectionId: 'rolePermissions',
                data: { beaconRolePermissionId: `${roleId}-${permissionKey}`, roleId, permissionKey, createdAt: '2026-01-01T00:00:00.000Z' },
              })),
              pagingMetadata: { hasNext, cursors: { next: hasNext ? `page-${pageIndex + 1}` : null } },
            }),
          };
        }

        if (dataCollectionId === 'organizationRolePermissionOverrides') {
          const overrides = options.overrides ?? [];
          return {
            ok: true,
            json: async () => ({
              dataItems: overrides.map((o, i) => ({
                id: `override-${i}`,
                dataCollectionId: 'organizationRolePermissionOverrides',
                data: {
                  beaconOverrideId: `override-${options.roleKey}-${o.permissionKey}`,
                  organizationId: DEFAULT_ORGANIZATION_ID,
                  roleKey: options.roleKey,
                  permissionKey: o.permissionKey,
                  action: o.action,
                  reason: 'test',
                  createdAt: '2026-01-01T00:00:00.000Z',
                  createdBy: 'identity-test',
                  updatedAt: '2026-01-01T00:00:00.000Z',
                },
              })),
            }),
          };
        }

        throw new Error(`Unexpected collection in test: ${dataCollectionId}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it("resolves Administrator's full real 68-permission set across two pages (50 + 18) — the exact shape of the live incident, including organization.manage, which was silently dropped by the unpaginated read", async () => {
      const page1 = PERMISSION_KEYS.slice(0, 50);
      const page2 = PERMISSION_KEYS.slice(50);
      expect(page2.length).toBe(18);
      stubWixRbacFetch({ roleKey: 'administrator', grantPages: [page1, page2] });

      const permissions = await resolvePermissionKeysForRole('administrator', DEFAULT_ORGANIZATION_ID, 'wix');

      expect(permissions.size).toBe(68);
      expect(permissions.has('organization.manage')).toBe(true);
      for (const key of PERMISSION_KEYS) expect(permissions.has(key)).toBe(true);
    });

    it('a role with exactly 50 grants (the old silent cap boundary) still resolves all 50 on a single page', async () => {
      const fifty = PERMISSION_KEYS.slice(0, 50);
      stubWixRbacFetch({ roleKey: 'administrator', grantPages: [fifty] });

      const permissions = await resolvePermissionKeysForRole('administrator', DEFAULT_ORGANIZATION_ID, 'wix');
      expect(permissions.size).toBe(50);
    });

    it("Office Staff's Manors ap.read revoke override still applies correctly after pagination: the legacy base grant (page 2) is present, but effective permissions exclude it", async () => {
      const page1 = PERMISSION_KEYS.slice(0, 50);
      const page2 = ['ap.read']; // the exact real-world shape: a legacy base grant living past page 1
      stubWixRbacFetch({
        roleKey: 'officeStaff',
        grantPages: [page1, page2],
        overrides: [{ permissionKey: 'ap.read', action: 'revoke' }],
      });

      const permissions = await resolvePermissionKeysForRole('officeStaff', DEFAULT_ORGANIZATION_ID, 'wix');

      expect(permissions.has('ap.read')).toBe(false); // revoked, even though the base grant (on page 2) was correctly read
      expect(permissions.has(page1[0])).toBe(true); // page-1 base grants still resolve normally
    });

    it("Read Only's Manors ap.read revoke override still applies correctly after pagination", async () => {
      const page1 = PERMISSION_KEYS.slice(0, 50);
      const page2 = ['ap.read'];
      stubWixRbacFetch({
        roleKey: 'readOnly',
        grantPages: [page1, page2],
        overrides: [{ permissionKey: 'ap.read', action: 'revoke' }],
      });

      const permissions = await resolvePermissionKeysForRole('readOnly', DEFAULT_ORGANIZATION_ID, 'wix');

      expect(permissions.has('ap.read')).toBe(false);
      expect(permissions.size).toBe(50);
    });

    it('a grant override on a permission that only exists on the second page still applies (grants still win where no revoke conflicts)', async () => {
      const page1 = PERMISSION_KEYS.slice(0, 50);
      const page2 = PERMISSION_KEYS.slice(50, 55); // 5 more base grants past the old cap
      const grantedExtra = PERMISSION_KEYS[60]; // NOT in either base page — purely an org grant
      stubWixRbacFetch({
        roleKey: 'manager',
        grantPages: [page1, page2],
        overrides: [{ permissionKey: grantedExtra, action: 'grant' }],
      });

      const permissions = await resolvePermissionKeysForRole('manager', DEFAULT_ORGANIZATION_ID, 'wix');

      expect(permissions.size).toBe(56); // 50 + 5 base + 1 granted
      expect(permissions.has(grantedExtra)).toBe(true);
      for (const key of page2) expect(permissions.has(key)).toBe(true); // page 2 base grants weren't lost
    });

    it('paginates fully even for a role with grants spread across three pages', async () => {
      const page1 = PERMISSION_KEYS.slice(0, 25);
      const page2 = PERMISSION_KEYS.slice(25, 50);
      const page3 = PERMISSION_KEYS.slice(50, 68);
      stubWixRbacFetch({ roleKey: 'administrator', grantPages: [page1, page2, page3] });

      const permissions = await resolvePermissionKeysForRole('administrator', DEFAULT_ORGANIZATION_ID, 'wix');
      expect(permissions.size).toBe(68);
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
