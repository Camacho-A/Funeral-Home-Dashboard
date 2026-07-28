import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem, deleteWixDataItem, WixDataApiError } from '../lib/wixDataApi';
import { mapWixRoleItem, buildWixRoleData, applyRoleUpdateToWixData, type WixRoleItem } from '../lib/wixRoleMapper';
import { mapWixRolePermissionItem, buildWixRolePermissionData, type WixRolePermissionItem } from '../lib/wixRolePermissionMapper';
import { mapWixOrganizationRoleItem, buildWixOrganizationRoleData, type WixOrganizationRoleItem } from '../lib/wixOrganizationRoleMapper';
import {
  mapWixOrganizationRoleAuditEntryItem,
  buildWixOrganizationRoleAuditEntryData,
  type WixOrganizationRoleAuditEntryItem,
} from '../lib/wixOrganizationRoleAuditEntryMapper';
import { buildWixPermissionData, type WixPermissionItem } from '../lib/wixPermissionMapper';
import type { Role } from '../types/role';
import type { RolePermission } from '../types/rolePermission';
import type { OrganizationRoleEnablement } from '../types/organizationRole';
import type { OrganizationRoleAuditAction, OrganizationRoleAuditEntry } from '../types/organizationRoleAuditEntry';
import type { PermissionKey } from '../domain/rbac/permissionCatalog';
import { PERMISSION_KEYS, PERMISSION_DESCRIPTIONS, permissionCategory } from '../domain/rbac/permissionCatalog';
import type { Membership, MembershipStatus } from '../types/membership';
import { DEFAULT_ROLE_DEFINITIONS } from '../domain/rbac/defaultRoles';
import { permissionFixtureId, defaultRoleFixtureId, defaultRolePermissionFixtureId, organizationRoleFixtureId } from '../domain/rbac/deterministicIds';
import { updateMembership } from './membershipService';
import { resolveRoleForKey, resolvePermissionKeysForRole } from './permissionService';
import { withOrganizationRoleLock, commitProtectedWrite } from './organizationLockService';
import { listMembershipsForOrganization, isActiveMembership } from './membershipService';
import {
  permissionFixtures,
  roleFixtures,
  rolePermissionFixtures,
  organizationRoleFixtures,
  organizationRoleAuditEntryFixtures,
} from './__mocks__/rbacFixtures';

/**
 * Phase 22 (Role-Based Access Control). Owns the lifecycle of `roles`,
 * `rolePermissions`, and `organizationRoles` records — role definition,
 * cloning, permission editing, and assignment. Never itself decides
 * whether a *caller* is allowed to perform one of these operations (that
 * check happens at the Route Handler layer via
 * `authorizationPolicyService.canManageRoles`, matching every other
 * service in this codebase, which trusts its caller already authorized
 * the request — see e.g. `services/organizationProvisioningService.ts`).
 *
 * **Security-correction round (2026-07-27/28):** every mutation that can
 * change who counts as an administrator for an organization —
 * `assignRole`, `removeRole`, `updateRole` (removing an admin-tier
 * permission from an assigned role), `deleteRole`, and `setMembershipStatus`
 * (disabling/removing an admin-tier member) — now runs inside
 * `services/organizationLockService.ts`'s `withOrganizationRoleLock`, and
 * checks the resulting admin count via `countActiveAdminTierMembers`
 * *inside* that lock, never before acquiring it. This closes a real
 * time-of-check-to-time-of-use race the original implementation had: two
 * concurrent requests could each read "at least one other administrator
 * exists" before either had written its own change, and both proceed,
 * leaving zero. See `services/roleService.test.ts`'s "concurrent removal
 * of the last two administrators" test for the reproduction.
 */
function nowIso(): string {
  return new Date().toISOString();
}

export class RoleServiceError extends Error {}

// ---------------------------------------------------------------------------
// Role CRUD (data access helpers)
// ---------------------------------------------------------------------------

export async function getRole(roleId: string, dataAdapterMode: DataAdapterMode): Promise<Role | null> {
  if (dataAdapterMode === 'mock') {
    return roleFixtures.find((r) => r.id === roleId) ?? null;
  }
  const response = await queryWixDataItems<WixRoleItem>('roles', { filter: { beaconRoleId: roleId }, paging: { limit: 1 } });
  return mapWixRoleItem(response.dataItems[0]?.data);
}

/** Inserts a role, or — if a row with this exact id already exists
    (a concurrent seeding attempt for the same deterministic id, or a
    genuine duplicate custom-role id, which `idFactory` collisions make
    vanishingly unlikely) — returns the existing row unchanged rather than
    erroring. Never used for a fresh custom role's *initial* insert path
    directly; see `insertNewRole` for that. */
async function insertRoleIdempotent(role: Role, dataAdapterMode: DataAdapterMode): Promise<Role> {
  if (dataAdapterMode === 'mock') {
    const existing = roleFixtures.find((r) => r.id === role.id);
    if (existing) return existing;
    roleFixtures.push(role);
    return role;
  }
  try {
    const inserted = await insertWixDataItem<WixRoleItem>('roles', buildWixRoleData(role), role.id);
    const mapped = mapWixRoleItem(inserted.data);
    if (!mapped) throw new RoleServiceError('Failed to create role.');
    return mapped;
  } catch (error) {
    if (error instanceof WixDataApiError && error.status === 409) {
      const existing = await getRole(role.id, dataAdapterMode);
      if (existing) return existing;
    }
    throw error;
  }
}

async function listRolePermissions(roleId: string, dataAdapterMode: DataAdapterMode): Promise<RolePermission[]> {
  if (dataAdapterMode === 'mock') {
    return rolePermissionFixtures.filter((rp) => rp.roleId === roleId);
  }
  const response = await queryWixDataItems<WixRolePermissionItem>('rolePermissions', { filter: { roleId } });
  return response.dataItems.map((item) => mapWixRolePermissionItem(item.data)).filter((rp): rp is RolePermission => rp !== null);
}

/** Inserts a role-permission grant, treating an id conflict (a concurrent
    seed of the same deterministic grant) as success rather than an error. */
async function insertRolePermissionIdempotent(rolePermission: RolePermission, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    if (rolePermissionFixtures.some((rp) => rp.id === rolePermission.id)) return;
    rolePermissionFixtures.push(rolePermission);
    return;
  }
  try {
    await insertWixDataItem<WixRolePermissionItem>('rolePermissions', buildWixRolePermissionData(rolePermission), rolePermission.id);
  } catch (error) {
    if (error instanceof WixDataApiError && error.status === 409) return;
    throw error;
  }
}

async function deleteRolePermissionRow(rolePermission: RolePermission, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const index = rolePermissionFixtures.findIndex((rp) => rp.id === rolePermission.id);
    if (index !== -1) rolePermissionFixtures.splice(index, 1);
    return;
  }
  await deleteWixDataItem('rolePermissions', rolePermission.id);
}

export async function listOrganizationRoleEnablements(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<OrganizationRoleEnablement[]> {
  if (dataAdapterMode === 'mock') {
    return organizationRoleFixtures.filter((e) => e.organizationId === organizationId);
  }
  const response = await queryWixDataItems<WixOrganizationRoleItem>('organizationRoles', { filter: { organizationId } });
  return response.dataItems.map((item) => mapWixOrganizationRoleItem(item.data)).filter((e): e is OrganizationRoleEnablement => e !== null);
}

/** Inserts an enablement row, treating an id conflict (a concurrent seed
    of the same organization+role enablement) as success rather than an
    error. */
async function insertOrganizationRoleEnablementIdempotent(enablement: OrganizationRoleEnablement, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    if (organizationRoleFixtures.some((e) => e.id === enablement.id)) return;
    organizationRoleFixtures.push(enablement);
    return;
  }
  try {
    await insertWixDataItem<WixOrganizationRoleItem>('organizationRoles', buildWixOrganizationRoleData(enablement), enablement.id);
  } catch (error) {
    if (error instanceof WixDataApiError && error.status === 409) return;
    throw error;
  }
}

/** Exported (Phase 23) so `services/invitationService.ts`'s
    `revokeInvitation` can log to the same `organizationRoleAuditEntries`
    collection without duplicating this logic. */
export async function insertAuditEntry(
  entry: Omit<OrganizationRoleAuditEntry, 'id' | 'createdAt'> & { id: string },
  dataAdapterMode: DataAdapterMode,
): Promise<OrganizationRoleAuditEntry> {
  const fullEntry: OrganizationRoleAuditEntry = { ...entry, createdAt: nowIso() };
  if (dataAdapterMode === 'mock') {
    organizationRoleAuditEntryFixtures.push(fullEntry);
    return fullEntry;
  }
  await insertWixDataItem<WixOrganizationRoleAuditEntryItem>('organizationRoleAuditEntries', buildWixOrganizationRoleAuditEntryData(fullEntry), fullEntry.id);
  return fullEntry;
}

export async function listAuditEntries(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<OrganizationRoleAuditEntry[]> {
  if (dataAdapterMode === 'mock') {
    return organizationRoleAuditEntryFixtures.filter((e) => e.organizationId === organizationId);
  }
  const response = await queryWixDataItems<WixOrganizationRoleAuditEntryItem>('organizationRoleAuditEntries', { filter: { organizationId } });
  return response.dataItems.map((item) => mapWixOrganizationRoleAuditEntryItem(item.data)).filter((e): e is OrganizationRoleAuditEntry => e !== null);
}

function auditAction(action: OrganizationRoleAuditAction): OrganizationRoleAuditAction {
  return action;
}

// ---------------------------------------------------------------------------
// Seeding — every id here is deterministic (domain/rbac/deterministicIds.ts),
// and every insert is idempotent-on-conflict, so concurrent seeding (two
// server instances cold-starting at once, or a seed re-run while another is
// in flight) can never create a duplicate permission, role, grant, or
// enablement row. No lock is needed here: unlike the admin-invariant
// mutations below, seeding has no "read N, decide, write" step whose
// intermediate state matters — every single write is independently
// idempotent by construction.
// ---------------------------------------------------------------------------

/** Seeds the full static permission catalog into the `permissions`
    collection — a queryable reference mirror, not read by any
    authorization decision (see `app/api/rbac/permissions/route.ts`'s own
    comment). Idempotent and safe under concurrent calls. */
export async function seedPermissionCatalog(dataAdapterMode: DataAdapterMode): Promise<void> {
  const now = nowIso();
  for (const key of PERMISSION_KEYS) {
    const id = permissionFixtureId(key);
    if (dataAdapterMode === 'mock') {
      if (!permissionFixtures.some((p) => p.id === id)) {
        permissionFixtures.push({ id, key, category: permissionCategory(key), description: PERMISSION_DESCRIPTIONS[key], createdAt: now });
      }
      continue;
    }
    try {
      await insertWixDataItem<WixPermissionItem>(
        'permissions',
        buildWixPermissionData({ id, key, category: permissionCategory(key), description: PERMISSION_DESCRIPTIONS[key], createdAt: now }),
        id,
      );
    } catch (error) {
      if (!(error instanceof WixDataApiError) || error.status !== 409) throw error;
    }
  }
}

/**
 * Creates the seven platform-default `roles` (+ their `rolePermissions`)
 * if they don't already exist — a one-time, global, idempotent bootstrap,
 * safe under concurrent calls (deterministic ids; every insert treats a
 * conflict as "already seeded," never an error). In mock mode these are
 * already statically seeded (`services/__mocks__/rbacFixtures.ts`).
 */
export async function seedPlatformDefaultRoles(dataAdapterMode: DataAdapterMode): Promise<Role[]> {
  const roles: Role[] = [];
  const now = nowIso();
  for (const definition of DEFAULT_ROLE_DEFINITIONS) {
    const roleId = defaultRoleFixtureId(definition.key);
    const role = await insertRoleIdempotent(
      {
        id: roleId,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        organizationId: null,
        isSystemDefault: true,
        createdAt: now,
        updatedAt: now,
      },
      dataAdapterMode,
    );
    for (const permissionKey of definition.permissions) {
      await insertRolePermissionIdempotent(
        { id: defaultRolePermissionFixtureId(definition.key, permissionKey), roleId, permissionKey, createdAt: now },
        dataAdapterMode,
      );
    }
    roles.push(role);
  }
  return roles;
}

/**
 * Enables all seven platform-default roles for one organization —
 * idempotent by (organizationId, roleKey) via deterministic enablement
 * ids, safe under concurrent calls for the same organization. Called once
 * at organization creation (Phase 20's provisioning flow).
 */
export async function seedDefaultRoles(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<{ enablements: OrganizationRoleEnablement[]; isNew: boolean }> {
  const before = await listOrganizationRoleEnablements(organizationId, dataAdapterMode);
  const isNew = before.length === 0;

  const defaultRoles = await seedPlatformDefaultRoles(dataAdapterMode);
  const now = nowIso();
  const enablements: OrganizationRoleEnablement[] = [];
  for (const role of defaultRoles) {
    const enablement: OrganizationRoleEnablement = { id: organizationRoleFixtureId(organizationId, role.key), organizationId, roleId: role.id, createdAt: now };
    await insertOrganizationRoleEnablementIdempotent(enablement, dataAdapterMode);
    enablements.push(enablement);
  }
  return { enablements, isNew };
}

/** Every role (platform default + custom) currently enabled for one
    organization — the Organization Roles Page's own data source. */
export async function listRolesForOrganization(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<Role[]> {
  const enablements = await listOrganizationRoleEnablements(organizationId, dataAdapterMode);
  const roles = await Promise.all(enablements.map((e) => getRole(e.roleId, dataAdapterMode)));
  return roles.filter((r): r is Role => r !== null);
}

// ---------------------------------------------------------------------------
// Custom roles
// ---------------------------------------------------------------------------

async function insertNewRole(role: Role, dataAdapterMode: DataAdapterMode): Promise<Role> {
  if (dataAdapterMode === 'mock') {
    roleFixtures.push(role);
    return role;
  }
  const inserted = await insertWixDataItem<WixRoleItem>('roles', buildWixRoleData(role), role.id);
  const mapped = mapWixRoleItem(inserted.data);
  if (!mapped) throw new RoleServiceError('Failed to create role.');
  return mapped;
}

export async function createCustomRole(
  params: { organizationId: string; name: string; description: string; permissions: PermissionKey[]; actorIdentityId: string; idFactory: () => string },
  dataAdapterMode: DataAdapterMode,
): Promise<Role> {
  const now = nowIso();
  const role: Role = {
    id: params.idFactory(),
    key: params.idFactory(),
    name: params.name,
    description: params.description,
    organizationId: params.organizationId,
    isSystemDefault: false,
    createdAt: now,
    updatedAt: now,
  };
  await insertNewRole(role, dataAdapterMode);
  for (const permissionKey of params.permissions) {
    await insertRolePermissionIdempotent({ id: params.idFactory(), roleId: role.id, permissionKey, createdAt: now }, dataAdapterMode);
  }
  await insertOrganizationRoleEnablementIdempotent({ id: params.idFactory(), organizationId: params.organizationId, roleId: role.id, createdAt: now }, dataAdapterMode);
  await insertAuditEntry(
    { id: params.idFactory(), organizationId: params.organizationId, actorIdentityId: params.actorIdentityId, action: auditAction('role_created'), roleId: role.id, targetIdentityId: null, previousRoleKey: null },
    dataAdapterMode,
  );
  return role;
}

/** Clones a role (platform default or another custom role already visible
    to this organization) into a new, independently editable custom role
    owned by this organization. The source role itself is never modified —
    "Platform default roles remain immutable." */
export async function cloneRole(
  params: { organizationId: string; sourceRoleId: string; name: string; description?: string; actorIdentityId: string; idFactory: () => string },
  dataAdapterMode: DataAdapterMode,
): Promise<Role> {
  const source = await getRole(params.sourceRoleId, dataAdapterMode);
  if (!source) throw new RoleServiceError('Source role not found.');
  if (source.organizationId !== null && source.organizationId !== params.organizationId) {
    throw new RoleServiceError('Cannot clone a role belonging to a different organization.');
  }

  const sourcePermissions = await listRolePermissions(source.id, dataAdapterMode);
  const now = nowIso();
  const role: Role = {
    id: params.idFactory(),
    key: params.idFactory(),
    name: params.name,
    description: params.description ?? source.description,
    organizationId: params.organizationId,
    isSystemDefault: false,
    createdAt: now,
    updatedAt: now,
  };
  await insertNewRole(role, dataAdapterMode);
  for (const sourcePermission of sourcePermissions) {
    await insertRolePermissionIdempotent({ id: params.idFactory(), roleId: role.id, permissionKey: sourcePermission.permissionKey, createdAt: now }, dataAdapterMode);
  }
  await insertOrganizationRoleEnablementIdempotent({ id: params.idFactory(), organizationId: params.organizationId, roleId: role.id, createdAt: now }, dataAdapterMode);
  await insertAuditEntry(
    { id: params.idFactory(), organizationId: params.organizationId, actorIdentityId: params.actorIdentityId, action: auditAction('role_cloned'), roleId: role.id, targetIdentityId: null, previousRoleKey: null },
    dataAdapterMode,
  );
  return role;
}

// ---------------------------------------------------------------------------
// The admin-invariant: "an organization can never be left with zero active
// administrators." Shared by every mutation that can affect it.
// ---------------------------------------------------------------------------

type AdminCountSimulation = {
  /** Treat this membership as not active for the count — used by
      `setMembershipStatus` to simulate disabling/removing a member. */
  excludeMembershipId?: string;
  /** Treat this one membership as holding a different role key than its
      currently-stored value — used by `assignRole`/`removeRole`. */
  roleOverride?: { membershipId: string; roleKey: string };
  /** Treat this one role id's permission set as the given set, rather
      than its currently-stored grants — used by `updateRole` when editing
      an assigned role's own permissions. */
  permissionOverride?: { roleId: string; permissions: Set<PermissionKey> };
};

/** Counts active members whose *effective* role (after applying the given
    hypothetical `simulation`, if any) resolves to `organization.manage`.
    Always resolves permissions fresh (`permissionService` no longer
    caches anything) so this reflects the true current state of the
    organization's roles/memberships every time it's called. */
async function countActiveAdminTierMembers(organizationId: string, dataAdapterMode: DataAdapterMode, simulation?: AdminCountSimulation): Promise<number> {
  const memberships = (await listMembershipsForOrganization(organizationId, dataAdapterMode)).filter(isActiveMembership);
  let count = 0;

  for (const membership of memberships) {
    if (simulation?.excludeMembershipId === membership.id) continue;

    const roleKey = simulation?.roleOverride?.membershipId === membership.id ? simulation.roleOverride.roleKey : membership.role;

    let permissions: Set<PermissionKey>;
    if (simulation?.permissionOverride) {
      const role = await resolveRoleForKey(roleKey, organizationId, dataAdapterMode);
      permissions =
        role && role.id === simulation.permissionOverride.roleId ? simulation.permissionOverride.permissions : await resolvePermissionKeysForRole(roleKey, organizationId, dataAdapterMode);
    } else {
      permissions = await resolvePermissionKeysForRole(roleKey, organizationId, dataAdapterMode);
    }

    if (permissions.has('organization.manage')) count++;
  }

  return count;
}

const STRANDED_ORGANIZATION_MESSAGE = 'This change would leave the organization with no administrator.';

/** Renames/redescribes a role and/or edits its permission set. Refuses to
    act on a platform-default role — "Platform default roles remain
    immutable" — clone it first instead. Runs inside the organization's
    role lock: if the change removes `organization.manage` from a role,
    the resulting admin count is checked (accounting for every active
    member currently holding this role) before any permission is actually
    removed — refusing the *entire* update rather than partially applying
    it. */
export async function updateRole(
  params: {
    roleId: string;
    name?: string;
    description?: string;
    addPermissions?: PermissionKey[];
    removePermissions?: PermissionKey[];
    actorIdentityId: string;
    idFactory: () => string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<Role> {
  const role = await getRole(params.roleId, dataAdapterMode);
  if (!role) throw new RoleServiceError('Role not found.');
  if (role.isSystemDefault || role.organizationId === null) {
    throw new RoleServiceError('Platform default roles are immutable — clone this role to customize it.');
  }
  const organizationId = role.organizationId;

  return withOrganizationRoleLock(organizationId, dataAdapterMode, async (lockHandle) => {
    const freshRole = await getRole(params.roleId, dataAdapterMode);
    if (!freshRole) throw new RoleServiceError('Role not found.');

    if (params.removePermissions?.length) {
      const currentGrants = await listRolePermissions(freshRole.id, dataAdapterMode);
      const hypotheticalKeys = new Set(currentGrants.map((g) => g.permissionKey));
      for (const key of params.removePermissions) hypotheticalKeys.delete(key);
      for (const key of params.addPermissions ?? []) hypotheticalKeys.add(key);

      const remainingAdmins = await countActiveAdminTierMembers(organizationId, dataAdapterMode, {
        permissionOverride: { roleId: freshRole.id, permissions: hypotheticalKeys },
      });
      if (remainingAdmins === 0) {
        throw new RoleServiceError(STRANDED_ORGANIZATION_MESSAGE);
      }
    }

    // The admin-count check above can involve several Wix Data reads (one
    // per active membership). Everything from here on is the actual
    // protected write, routed through `commitProtectedWrite` — which
    // structurally prevents this lease from being reclaimed while this
    // write is in flight (see `organizationLockService.ts`'s own comment
    // for why a bare re-check immediately before the write, on its own,
    // is not sufficient).
    return commitProtectedWrite(lockHandle, dataAdapterMode, async () => {
      let updated = freshRole;
      if (params.name !== undefined || params.description !== undefined) {
        const now = nowIso();
        if (dataAdapterMode === 'mock') {
          const index = roleFixtures.findIndex((r) => r.id === freshRole.id);
          roleFixtures[index] = { ...roleFixtures[index], name: params.name ?? roleFixtures[index].name, description: params.description ?? roleFixtures[index].description, updatedAt: now };
          updated = roleFixtures[index];
        } else {
          const response = await queryWixDataItems<WixRoleItem>('roles', { filter: { beaconRoleId: freshRole.id }, paging: { limit: 1 } });
          const existingItem = response.dataItems[0];
          if (!existingItem) throw new RoleServiceError('Role not found.');
          const merged = applyRoleUpdateToWixData(existingItem.data, { name: params.name, description: params.description, updatedAt: now });
          const result = await updateWixDataItem<WixRoleItem>('roles', existingItem.id, merged);
          const mapped = mapWixRoleItem(result.data);
          if (!mapped) throw new RoleServiceError('Failed to update role.');
          updated = mapped;
        }
      }

      for (const permissionKey of params.addPermissions ?? []) {
        const existingGrants = await listRolePermissions(freshRole.id, dataAdapterMode);
        if (existingGrants.some((rp) => rp.permissionKey === permissionKey)) continue;
        await insertRolePermissionIdempotent({ id: params.idFactory(), roleId: freshRole.id, permissionKey, createdAt: nowIso() }, dataAdapterMode);
      }
      for (const permissionKey of params.removePermissions ?? []) {
        const existingGrants = await listRolePermissions(freshRole.id, dataAdapterMode);
        const grant = existingGrants.find((rp) => rp.permissionKey === permissionKey);
        if (grant) await deleteRolePermissionRow(grant, dataAdapterMode);
      }

      await insertAuditEntry(
        { id: params.idFactory(), organizationId, actorIdentityId: params.actorIdentityId, action: auditAction('role_updated'), roleId: freshRole.id, targetIdentityId: null, previousRoleKey: null },
        dataAdapterMode,
      );

      return updated;
    });
  });
}

/** Deletes a custom role. Refuses to act on a platform default, and
    refuses to delete a role currently assigned to any active membership
    (reassign those members first) — a role is never silently orphaned
    out from under a member. Runs inside the organization's role lock, and
    re-checks assignment *inside* it — fail-closed against a concurrent
    assignment landing between an earlier, unlocked check and this call. */
export async function deleteRole(params: { roleId: string; actorIdentityId: string; idFactory: () => string }, dataAdapterMode: DataAdapterMode): Promise<void> {
  const role = await getRole(params.roleId, dataAdapterMode);
  if (!role) throw new RoleServiceError('Role not found.');
  if (role.isSystemDefault || role.organizationId === null) {
    throw new RoleServiceError('Platform default roles cannot be deleted.');
  }
  const organizationId = role.organizationId;

  await withOrganizationRoleLock(organizationId, dataAdapterMode, async (lockHandle) => {
    const memberships = (await listMembershipsForOrganization(organizationId, dataAdapterMode)).filter(isActiveMembership);
    if (memberships.some((m) => m.role === role.key)) {
      throw new RoleServiceError('Cannot delete a role that is currently assigned to one or more members. Reassign them first.');
    }

    await commitProtectedWrite(lockHandle, dataAdapterMode, async () => {
      const permissions = await listRolePermissions(role.id, dataAdapterMode);
      for (const permission of permissions) {
        await deleteRolePermissionRow(permission, dataAdapterMode);
      }

      if (dataAdapterMode === 'mock') {
        const enablementIndex = organizationRoleFixtures.findIndex((e) => e.organizationId === organizationId && e.roleId === role.id);
        if (enablementIndex !== -1) organizationRoleFixtures.splice(enablementIndex, 1);
        const roleIndex = roleFixtures.findIndex((r) => r.id === role.id);
        if (roleIndex !== -1) roleFixtures.splice(roleIndex, 1);
      } else {
        const enablementResponse = await queryWixDataItems<WixOrganizationRoleItem>('organizationRoles', { filter: { organizationId, roleId: role.id }, paging: { limit: 1 } });
        const enablementItem = enablementResponse.dataItems[0];
        if (enablementItem) await deleteWixDataItem('organizationRoles', enablementItem.id);

        const roleResponse = await queryWixDataItems<WixRoleItem>('roles', { filter: { beaconRoleId: role.id }, paging: { limit: 1 } });
        const roleItem = roleResponse.dataItems[0];
        if (roleItem) await deleteWixDataItem('roles', roleItem.id);
      }

      await insertAuditEntry(
        { id: params.idFactory(), organizationId, actorIdentityId: params.actorIdentityId, action: auditAction('role_deleted'), roleId: role.id, targetIdentityId: null, previousRoleKey: null },
        dataAdapterMode,
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

async function changeMembershipRole(
  params: { membership: Membership; roleKey: string; actorIdentityId: string; idFactory: () => string },
  action: 'role_assigned' | 'role_removed',
  dataAdapterMode: DataAdapterMode,
): Promise<{ membership: Membership; auditEntry: OrganizationRoleAuditEntry }> {
  return withOrganizationRoleLock(params.membership.organizationId, dataAdapterMode, async (lockHandle) => {
    const role = await resolveRoleForKey(params.roleKey, params.membership.organizationId, dataAdapterMode);
    if (!role) throw new RoleServiceError('Role not found for this organization.');

    const remainingAdmins = await countActiveAdminTierMembers(params.membership.organizationId, dataAdapterMode, {
      roleOverride: { membershipId: params.membership.id, roleKey: params.roleKey },
    });
    if (remainingAdmins === 0) {
      throw new RoleServiceError(STRANDED_ORGANIZATION_MESSAGE);
    }

    return commitProtectedWrite(lockHandle, dataAdapterMode, async () => {
      const previousRoleKey = params.membership.role;
      const updated = await updateMembership(params.membership.id, { role: params.roleKey }, dataAdapterMode);
      if (!updated) throw new RoleServiceError('Membership not found.');

      const auditEntry = await insertAuditEntry(
        {
          id: params.idFactory(),
          organizationId: params.membership.organizationId,
          actorIdentityId: params.actorIdentityId,
          action: auditAction(action),
          roleId: role.id,
          targetIdentityId: params.membership.identityId,
          previousRoleKey,
        },
        dataAdapterMode,
      );

      return { membership: updated, auditEntry };
    });
  });
}

/** Assigns a role to an existing membership — "Assigned Role" in the
    phase spec's flow diagram. Validates the role actually resolves for
    this organization first (rejects an unknown key or a custom role
    belonging to a different organization — the same cross-tenant check
    `resolveRoleForKey` enforces for permission resolution itself), then
    refuses — under the organization's role lock — if it would leave the
    organization with zero administrators. */
export function assignRole(
  params: { membership: Membership; roleKey: string; actorIdentityId: string; idFactory: () => string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ membership: Membership; auditEntry: OrganizationRoleAuditEntry }> {
  return changeMembershipRole(params, 'role_assigned', dataAdapterMode);
}

/** Removes a member's current role assignment, falling back to the
    least-privileged default role ('readOnly') rather than leaving the
    membership with no role at all — a membership always has some role for
    as long as it's active; fully removing a member from an organization is
    `setMembershipStatus`'s concern, not this function's. */
export function removeRole(
  params: { membership: Membership; actorIdentityId: string; idFactory: () => string; fallbackRoleKey?: string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ membership: Membership; auditEntry: OrganizationRoleAuditEntry }> {
  const fallbackRoleKey = params.fallbackRoleKey ?? 'readOnly';
  return changeMembershipRole({ membership: params.membership, roleKey: fallbackRoleKey, actorIdentityId: params.actorIdentityId, idFactory: params.idFactory }, 'role_removed', dataAdapterMode);
}

/** Disables or removes a membership (`status: 'disabled'|'removed'`) —
    the guarded path for anything that takes an active member out of the
    organization's effective membership set, matching the same
    admin-invariant every role change is held to. No route calls this yet
    (removing a member from an organization is out of this phase's UI
    scope — see ADR-026's deferred list) but the guard exists here, at the
    service layer, so the invariant holds the moment such a route is
    built, rather than depending on that future route remembering to
    re-implement it. Runs inside the organization's role lock. */
export async function setMembershipStatus(
  params: { membership: Membership; status: MembershipStatus; actorIdentityId: string; idFactory: () => string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ membership: Membership; auditEntry: OrganizationRoleAuditEntry | null }> {
  if (params.membership.status === 'invited') {
    throw new RoleServiceError('This membership is a pending invitation — use revokeInvitation to cancel it.');
  }

  // 'removed' is terminal: a removed membership never comes back through
  // this function — re-adding someone requires a fresh invitation.
  if (params.membership.status === 'removed' && params.status !== 'removed') {
    throw new RoleServiceError('This membership was removed. Invite them again instead.');
  }

  // Idempotent no-op: already in the requested status. No duplicate audit
  // entry, no lock, no write.
  if (params.membership.status === params.status) {
    return { membership: params.membership, auditEntry: null };
  }

  if (params.status === 'active') {
    // Reactivation can only ever *add* an administrator back, never remove
    // one — no admin-invariant check needed, matching the pre-existing
    // design. Phase 23 fix: this branch previously returned
    // `auditEntry: null` unconditionally, so reactivation was never
    // audited — now it is.
    const updated = await updateMembership(params.membership.id, { status: 'active' }, dataAdapterMode);
    if (!updated) throw new RoleServiceError('Membership not found.');
    const auditEntry = await insertAuditEntry(
      {
        id: params.idFactory(),
        organizationId: params.membership.organizationId,
        actorIdentityId: params.actorIdentityId,
        action: auditAction('membership_reactivated'),
        roleId: null,
        targetIdentityId: params.membership.identityId,
        previousRoleKey: params.membership.role,
      },
      dataAdapterMode,
    );
    return { membership: updated, auditEntry };
  }

  return withOrganizationRoleLock(params.membership.organizationId, dataAdapterMode, async (lockHandle) => {
    const remainingAdmins = await countActiveAdminTierMembers(params.membership.organizationId, dataAdapterMode, {
      excludeMembershipId: params.membership.id,
    });
    if (remainingAdmins === 0) {
      throw new RoleServiceError(STRANDED_ORGANIZATION_MESSAGE);
    }

    return commitProtectedWrite(lockHandle, dataAdapterMode, async () => {
      const updated = await updateMembership(params.membership.id, { status: params.status }, dataAdapterMode);
      if (!updated) throw new RoleServiceError('Membership not found.');

      const auditEntry = await insertAuditEntry(
        {
          id: params.idFactory(),
          organizationId: params.membership.organizationId,
          actorIdentityId: params.actorIdentityId,
          action: auditAction(params.status === 'disabled' ? 'membership_disabled' : 'membership_removed'),
          roleId: null,
          targetIdentityId: params.membership.identityId,
          previousRoleKey: params.membership.role,
        },
        dataAdapterMode,
      );

      return { membership: updated, auditEntry };
    });
  });
}
