import type { Permission } from '../../types/permission';
import type { Role } from '../../types/role';
import type { RolePermission } from '../../types/rolePermission';
import type { OrganizationRoleEnablement } from '../../types/organizationRole';
import type { OrganizationRoleAuditEntry } from '../../types/organizationRoleAuditEntry';
import type { OrganizationRolePermissionOverride } from '../../types/organizationRolePermissionOverride';
import type { OrganizationRoleLock } from '../../types/organizationRoleLock';
import type { OrganizationRoleWriteClaim } from '../../types/organizationRoleWriteClaim';
import { PERMISSION_KEYS, PERMISSION_DESCRIPTIONS, permissionCategory } from '../../domain/rbac/permissionCatalog';
import { DEFAULT_ROLE_DEFINITIONS } from '../../domain/rbac/defaultRoles';
import { permissionFixtureId, defaultRoleFixtureId, defaultRolePermissionFixtureId, organizationRoleFixtureId } from '../../domain/rbac/deterministicIds';
import { DEFAULT_ORGANIZATION_ID, GUS_ORGANIZATION_ID } from './organizationIds';
import { mockCollection } from './mockStore';

/**
 * Phase 22 (Role-Based Access Control). Mock-mode fixtures — same
 * "in-memory arrays, mutated in place by the RBAC services' mock branch"
 * convention as every other `services/__mocks__/*Fixtures.ts` file.
 *
 * Seeds the full permission catalog, the seven platform-default roles
 * (`domain/rbac/defaultRoles.ts`) and their permission grants, and enables
 * all seven for Manor's Cremation (`DEFAULT_ORGANIZATION_ID`) — the same
 * "seed the one real tenant's row in the fixture file itself" convention
 * `identityFixtures.ts`/`organizationLocationFixtures` already
 * established, representing that `RoleService.seedDefaultRoles` has
 * already run for this organization.
 *
 * Security-correction round (2026-07-27/28): every id below is
 * **deterministically derived from its semantic key**
 * (`domain/rbac/deterministicIds.ts`) rather than an arbitrary counter —
 * the exact same derivation `services/roleService.ts`'s live-mode seeding
 * now uses. This is what makes concurrent seeding safe: two callers
 * seeding the same logical row compute the *same* id, so the second
 * insert collides with the first (caught and treated as "already exists")
 * instead of creating a duplicate with a different random id.
 */
const NOW = '2026-07-27T00:00:00.000Z';

export const permissionFixtures: Permission[] = mockCollection('permissionFixtures', (): Permission[] => PERMISSION_KEYS.map((key) => ({
  id: permissionFixtureId(key),
  key,
  category: permissionCategory(key),
  description: PERMISSION_DESCRIPTIONS[key],
  createdAt: NOW,
})));

export const roleFixtures: Role[] = mockCollection('roleFixtures', (): Role[] => DEFAULT_ROLE_DEFINITIONS.map((def) => ({
  id: defaultRoleFixtureId(def.key),
  key: def.key,
  name: def.name,
  description: def.description,
  organizationId: null,
  isSystemDefault: true,
  createdAt: NOW,
  updatedAt: NOW,
})));

export const rolePermissionFixtures: RolePermission[] = mockCollection('rolePermissionFixtures', (): RolePermission[] => DEFAULT_ROLE_DEFINITIONS.flatMap((def) =>
  def.permissions.map((permissionKey) => ({
    id: defaultRolePermissionFixtureId(def.key, permissionKey),
    roleId: defaultRoleFixtureId(def.key),
    permissionKey,
    createdAt: NOW,
  })),
));

/**
 * Manors role-model correction (2026-09): Manor's Cremation's authoritative
 * role roster is exactly these seven — 'arranger' is deliberately excluded
 * (a real platform-default role other organizations may use, but never
 * enabled/selectable/assignable for Manors specifically) — mirroring the
 * live Wix `organizationRoles` state exactly (confirmed via live read
 * during this correction: managed-cremations has 6 enablement rows today,
 * missing 'accounting' — a real data gap flagged for a separate, approved
 * live fix — this mock fixture reflects the *intended*, fully-corrected
 * roster of 7, not today's live gap, so tests exercise the target state).
 */
const MANORS_ENABLED_ROLE_KEYS: readonly string[] = ['administrator', 'manager', 'funeralDirector', 'officeStaff', 'accounting', 'readOnly', 'dispatch'];

/**
 * Gus Camacho Jr. Funeral Home (mock/local development only): the same
 * seven default roles enabled for Gus — what `RoleService.seedDefaultRoles`
 * would produce for a newly-provisioned organization with Manors' roster.
 * Role permissions themselves are the shared platform-default grants
 * above; nothing Gus-specific is granted here.
 */
const GUS_ENABLED_ROLE_KEYS: readonly string[] = MANORS_ENABLED_ROLE_KEYS;

function enablementRows(organizationId: string, roleKeys: readonly string[]): OrganizationRoleEnablement[] {
  return DEFAULT_ROLE_DEFINITIONS.filter((def) => roleKeys.includes(def.key)).map((def) => ({
    id: organizationRoleFixtureId(organizationId, def.key),
    organizationId,
    roleId: defaultRoleFixtureId(def.key),
    createdAt: NOW,
  }));
}

export const organizationRoleFixtures: OrganizationRoleEnablement[] = mockCollection('organizationRoleFixtures', (): OrganizationRoleEnablement[] => [
  ...enablementRows(DEFAULT_ORGANIZATION_ID, MANORS_ENABLED_ROLE_KEYS),
  ...enablementRows(GUS_ORGANIZATION_ID, GUS_ENABLED_ROLE_KEYS),
]);

export const organizationRoleAuditEntryFixtures: OrganizationRoleAuditEntry[] = mockCollection('organizationRoleAuditEntryFixtures', (): OrganizationRoleAuditEntry[] => []);
export const organizationRolePermissionOverrideFixtures: OrganizationRolePermissionOverride[] = mockCollection('organizationRolePermissionOverrideFixtures', (): OrganizationRolePermissionOverride[] => []);
export const organizationRoleLockFixtures: OrganizationRoleLock[] = mockCollection('organizationRoleLockFixtures', (): OrganizationRoleLock[] => []);
export const organizationRoleWriteClaimFixtures: OrganizationRoleWriteClaim[] = mockCollection('organizationRoleWriteClaimFixtures', (): OrganizationRoleWriteClaim[] => []);
