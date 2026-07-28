import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems } from '../lib/wixDataApi';
import { mapWixRoleItem, type WixRoleItem } from '../lib/wixRoleMapper';
import { mapWixRolePermissionItem, type WixRolePermissionItem } from '../lib/wixRolePermissionMapper';
import type { Role } from '../types/role';
import type { RolePermission } from '../types/rolePermission';
import type { PermissionKey } from '../domain/rbac/permissionCatalog';
import { resolveRoleKeyAlias } from '../domain/rbac/legacyRoleAliases';
import { roleFixtures, rolePermissionFixtures } from './__mocks__/rbacFixtures';

/**
 * Phase 22 (Role-Based Access Control). Resolves *what a role may do* —
 * the "Assigned Role -> Resolved Permissions" step of the authorization
 * flow described in the phase spec. Never itself decides whether a
 * *specific operation* is allowed (that's `authorizationPolicyService.ts`)
 * and never looks up *which* role an identity holds (that's
 * `membershipService.ts`'s `Membership.role` for identity-mode sessions,
 * or `lib/auth/authorize.ts`'s `OrganizationMembership.role` for
 * mock/wix-mode sessions) — this module only ever takes a role key it's
 * given and turns it into a permission set.
 *
 * **No cross-request permission cache** (security-correction round,
 * 2026-07-27/28). An earlier version of this module cached resolved
 * permission sets per `(identityId, organizationId)` in a process-local
 * `Map`, invalidated explicitly by `RoleService` on role/membership
 * changes. That cache was only ever correct for a single-process
 * deployment: any deployment running more than one application instance
 * (multiple Node processes, multiple serverless invocations, a
 * multi-replica container deployment) could serve a request against one
 * instance's stale cached permissions after a role change was written by
 * a *different* instance, which never invalidated the first instance's
 * in-memory `Map` at all — a real authorization-correctness gap, not a
 * theoretical one. Removing the cache trades a handful of extra Wix Data
 * reads per authorization check for a guarantee that every check reads
 * the current role/permission state, with no dependency on which
 * instance served a previous mutation. Every `resolve*`/`has*` function
 * below always resolves fresh, every call, with no shared state carried
 * between calls.
 */

// ---------------------------------------------------------------------------
// Role -> permission resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a role key (a legacy `MembershipRole`/`OrganizationRole` value,
 * a Phase 22 default role key, or a custom role's generated key) to its
 * `Role` row. Returns `null` for an unknown key, or — critically — for a
 * *custom* role that belongs to a different organization than the one
 * requesting it: this is the one place cross-organization permission
 * leakage is structurally prevented, even if a custom role key were
 * somehow guessed or reused. Platform-default roles (`organizationId:
 * null`) are shared and always resolve regardless of which organization
 * asks. **Fail-closed**: any role key this function cannot resolve to a
 * real, in-scope `Role` row returns `null` here, which every caller below
 * turns into an *empty* permission set — never a fallback to a default or
 * elevated permission set.
 */
export async function resolveRoleForKey(roleKey: string, organizationId: string, dataAdapterMode: DataAdapterMode): Promise<Role | null> {
  const canonicalKey = resolveRoleKeyAlias(roleKey);

  if (dataAdapterMode === 'mock') {
    const role = roleFixtures.find((r) => r.key === canonicalKey);
    if (!role) return null;
    if (role.organizationId !== null && role.organizationId !== organizationId) return null;
    return role;
  }

  const response = await queryWixDataItems<WixRoleItem>('roles', {
    filter: { key: canonicalKey },
    paging: { limit: 1 },
  });
  const role = mapWixRoleItem(response.dataItems[0]?.data);
  if (!role) return null;
  if (role.organizationId !== null && role.organizationId !== organizationId) return null;
  return role;
}

async function fetchRolePermissions(roleId: string, dataAdapterMode: DataAdapterMode): Promise<PermissionKey[]> {
  if (dataAdapterMode === 'mock') {
    return rolePermissionFixtures.filter((rp) => rp.roleId === roleId).map((rp) => rp.permissionKey);
  }
  const response = await queryWixDataItems<WixRolePermissionItem>('rolePermissions', {
    filter: { roleId },
  });
  return response.dataItems
    .map((item) => mapWixRolePermissionItem(item.data))
    .filter((rp): rp is RolePermission => rp !== null)
    .map((rp) => rp.permissionKey);
}

/** Resolves a role key directly to its permission set — always a fresh
    read, never cached. An unresolvable role key (unknown, or a custom
    role belonging to a different organization) yields an empty set,
    fail-closed. */
export async function resolvePermissionKeysForRole(roleKey: string, organizationId: string, dataAdapterMode: DataAdapterMode): Promise<Set<PermissionKey>> {
  const role = await resolveRoleForKey(roleKey, organizationId, dataAdapterMode);
  if (!role) return new Set();
  return new Set(await fetchRolePermissions(role.id, dataAdapterMode));
}

export type ResolvePermissionsParams = {
  identityId: string;
  organizationId: string;
  roleKey: string;
};

/**
 * The one function every authorization decision ultimately resolves
 * through: "Assigned Role -> Resolved Permissions" from the phase spec's
 * flow diagram. `identityId` is accepted for a uniform call shape across
 * every auth mode (pass `session.user.id` for a mock/wix-mode session
 * exactly as for an identity-mode session) but is otherwise unused here —
 * there is no cache keyed on it to look up.
 */
export async function resolvePermissions(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode): Promise<Set<PermissionKey>> {
  return resolvePermissionKeysForRole(params.roleKey, params.organizationId, dataAdapterMode);
}

export async function hasPermission(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode, permission: PermissionKey): Promise<boolean> {
  const permissions = await resolvePermissions(params, dataAdapterMode);
  return permissions.has(permission);
}

export async function hasAnyPermission(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode, permissions: readonly PermissionKey[]): Promise<boolean> {
  const resolved = await resolvePermissions(params, dataAdapterMode);
  return permissions.some((permission) => resolved.has(permission));
}

export async function hasAllPermissions(params: ResolvePermissionsParams, dataAdapterMode: DataAdapterMode, permissions: readonly PermissionKey[]): Promise<boolean> {
  const resolved = await resolvePermissions(params, dataAdapterMode);
  return permissions.every((permission) => resolved.has(permission));
}
