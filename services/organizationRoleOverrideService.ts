import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem, deleteWixDataItem, WixDataApiError } from '../lib/wixDataApi';
import {
  mapWixOrganizationRolePermissionOverrideItem,
  buildWixOrganizationRolePermissionOverrideData,
  type WixOrganizationRolePermissionOverrideItem,
} from '../lib/wixOrganizationRolePermissionOverrideMapper';
import type { OrganizationRolePermissionOverride, OrganizationRolePermissionOverrideAction } from '../types/organizationRolePermissionOverride';
import { isPermissionKey, type PermissionKey } from '../domain/rbac/permissionCatalog';
import { isDefaultRoleKey, defaultRoleDefinition, type DefaultRoleKey } from '../domain/rbac/defaultRoles';
import { resolveRoleKeyAlias } from '../domain/rbac/legacyRoleAliases';
import { organizationRolePermissionOverrideId } from '../domain/rbac/deterministicIds';
import { applyPermissionOverrides } from '../domain/rbac/permissionOverrides';
import { withOrganizationRoleLock, commitProtectedWrite } from './organizationLockService';
import { countActiveAdminTierMembers } from './roleService';
import { insertAuditEntry } from './roleService';
import { organizationRolePermissionOverrideFixtures } from './__mocks__/rbacFixtures';

/**
 * Manors go-live hardening (2026-09). Owns the lifecycle of
 * `organizationRolePermissionOverrides` — the organization-scoped layer
 * described in `types/organizationRolePermissionOverride.ts`'s own
 * comment. Mirrors `services/roleService.ts`'s own shape deliberately
 * (error class, mock/wix dual-branch helpers, deterministic idempotent
 * writes, the same admin-invariant lock reuse) rather than inventing a
 * parallel style.
 *
 * Never itself decides whether a *caller* may manage overrides — that is
 * the Route Handler's job via `authorizationPolicyService`, matching
 * every other service in this codebase.
 */
export class RoleOverrideServiceError extends Error {}

const COLLECTION = 'organizationRolePermissionOverrides';

function nowIso(): string {
  return new Date().toISOString();
}

function assertValidRoleKey(roleKey: string): DefaultRoleKey {
  const canonical = resolveRoleKeyAlias(roleKey);
  if (!isDefaultRoleKey(canonical)) {
    throw new RoleOverrideServiceError(`"${roleKey}" is not a platform-default role key. Organization overrides are only supported for platform-default roles in this implementation.`);
  }
  return canonical;
}

function assertValidPermissionKey(permissionKey: string): PermissionKey {
  if (!isPermissionKey(permissionKey)) {
    throw new RoleOverrideServiceError(`"${permissionKey}" is not a recognized permission key.`);
  }
  return permissionKey;
}

function assertValidAction(action: string): OrganizationRolePermissionOverrideAction {
  if (action !== 'grant' && action !== 'revoke') {
    throw new RoleOverrideServiceError(`"${action}" is not a valid override action — must be "grant" or "revoke".`);
  }
  return action;
}

/** All override rows for one organization — the management API's list view. */
export async function listOverridesForOrganization(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<OrganizationRolePermissionOverride[]> {
  if (dataAdapterMode === 'mock') {
    return organizationRolePermissionOverrideFixtures.filter((o) => o.organizationId === organizationId);
  }
  const response = await queryWixDataItems<WixOrganizationRolePermissionOverrideItem>(COLLECTION, { filter: { organizationId } });
  return response.dataItems.map((item) => mapWixOrganizationRolePermissionOverrideItem(item.data)).filter((o): o is OrganizationRolePermissionOverride => o !== null);
}

/** One organization's override rows for exactly one (canonical) role key —
    the function `permissionService.ts#resolvePermissionKeysForRole` calls
    on every single authorization check. Returns `[]` for any role key
    with no overrides (the overwhelming common case), never throwing —
    this is a read path every request flows through and must never itself
    become a new failure mode. */
export async function getOverridesForRole(organizationId: string, roleKey: string, dataAdapterMode: DataAdapterMode): Promise<OrganizationRolePermissionOverride[]> {
  const canonical = resolveRoleKeyAlias(roleKey);
  if (dataAdapterMode === 'mock') {
    return organizationRolePermissionOverrideFixtures.filter((o) => o.organizationId === organizationId && o.roleKey === canonical);
  }
  const response = await queryWixDataItems<WixOrganizationRolePermissionOverrideItem>(COLLECTION, { filter: { organizationId, roleKey: canonical } });
  return response.dataItems.map((item) => mapWixOrganizationRolePermissionOverrideItem(item.data)).filter((o): o is OrganizationRolePermissionOverride => o !== null);
}

async function getOverrideRow(id: string, dataAdapterMode: DataAdapterMode): Promise<OrganizationRolePermissionOverride | null> {
  if (dataAdapterMode === 'mock') {
    return organizationRolePermissionOverrideFixtures.find((o) => o.id === id) ?? null;
  }
  const response = await queryWixDataItems<WixOrganizationRolePermissionOverrideItem>(COLLECTION, { filter: { beaconOverrideId: id }, paging: { limit: 1 } });
  return mapWixOrganizationRolePermissionOverrideItem(response.dataItems[0]?.data);
}

/** Computes what this role's effective permission set *would* be, in this
    organization, if `pendingChange` were applied on top of every
    currently-persisted override for the role — used only to check the
    admin-invariant before a revoke is committed. Base is always the
    *code* catalog (`defaultRoleDefinition`), matching exactly what
    `resolvePermissionKeysForRole` will compute once this write lands. */
async function simulateEffectivePermissions(
  organizationId: string,
  roleKey: DefaultRoleKey,
  pendingChange: { permissionKey: PermissionKey; action: OrganizationRolePermissionOverrideAction },
  dataAdapterMode: DataAdapterMode,
): Promise<Set<PermissionKey>> {
  const existing = await getOverridesForRole(organizationId, roleKey, dataAdapterMode);
  const withoutThisPermission = existing.filter((o) => o.permissionKey !== pendingChange.permissionKey);
  const base = defaultRoleDefinition(roleKey).permissions;
  return applyPermissionOverrides(base, [...withoutThisPermission, pendingChange]);
}

/** Creates a new override, or updates an existing one's `action`/`reason`
    in place (same deterministic id — see
    `domain/rbac/deterministicIds.ts#organizationRolePermissionOverrideId`).
    Rejects an unknown role key, an unknown/stale permission key, or an
    invalid action before touching any data. A `revoke` of
    `organization.manage` is additionally checked, inside the
    organization's existing role lock, against the same
    "never strand the organization with zero administrators" invariant
    `updateRole` already enforces for a direct grant edit. */
export async function upsertOverride(
  params: {
    organizationId: string;
    roleKey: string;
    permissionKey: string;
    action: string;
    reason?: string | null;
    actorIdentityId: string;
    idFactory: () => string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<OrganizationRolePermissionOverride> {
  const roleKey = assertValidRoleKey(params.roleKey);
  const permissionKey = assertValidPermissionKey(params.permissionKey);
  const action = assertValidAction(params.action);
  const { organizationId } = params;
  const id = organizationRolePermissionOverrideId(organizationId, roleKey, permissionKey);

  return withOrganizationRoleLock(organizationId, dataAdapterMode, async (lockHandle) => {
    if (action === 'revoke' && permissionKey === 'organization.manage') {
      const hypothetical = await simulateEffectivePermissions(organizationId, roleKey, { permissionKey, action }, dataAdapterMode);
      const remainingAdmins = await countActiveAdminTierMembers(organizationId, dataAdapterMode, {
        roleKeyPermissionOverride: { roleKey, permissions: hypothetical },
      });
      if (remainingAdmins === 0) {
        throw new RoleOverrideServiceError('This change would leave the organization with no administrator.');
      }
    }

    return commitProtectedWrite(lockHandle, dataAdapterMode, async () => {
      const now = nowIso();
      const existing = await getOverrideRow(id, dataAdapterMode);
      const override: OrganizationRolePermissionOverride = {
        id,
        organizationId,
        roleKey,
        permissionKey,
        action,
        reason: params.reason ?? null,
        createdAt: existing?.createdAt ?? now,
        createdBy: existing?.createdBy ?? params.actorIdentityId,
        updatedAt: now,
      };

      if (dataAdapterMode === 'mock') {
        const index = organizationRolePermissionOverrideFixtures.findIndex((o) => o.id === id);
        if (index === -1) organizationRolePermissionOverrideFixtures.push(override);
        else organizationRolePermissionOverrideFixtures[index] = override;
      } else if (existing) {
        await updateWixDataItem<WixOrganizationRolePermissionOverrideItem>(COLLECTION, id, buildWixOrganizationRolePermissionOverrideData(override));
      } else {
        try {
          await insertWixDataItem<WixOrganizationRolePermissionOverrideItem>(COLLECTION, buildWixOrganizationRolePermissionOverrideData(override), id);
        } catch (error) {
          // A 409 here means a concurrent caller won the race to create this
          // exact deterministic id first — idempotent success, not an error;
          // re-read and return the row that landed rather than overwrite it.
          if (error instanceof WixDataApiError && error.status === 409) {
            const landed = await getOverrideRow(id, dataAdapterMode);
            if (landed) return landed;
          }
          throw error;
        }
      }

      await insertAuditEntry(
        {
          id: params.idFactory(),
          organizationId,
          actorIdentityId: params.actorIdentityId,
          action: action === 'grant' ? 'override_granted' : 'override_revoked',
          roleId: null,
          targetIdentityId: null,
          previousRoleKey: null,
          permissionKey,
        },
        dataAdapterMode,
      );

      return override;
    });
  });
}

/** Deletes an override, reverting that `(organizationId, roleKey,
    permissionKey)` tuple to pure base-role behavior. A no-op (not an
    error) if no such override exists — removal is idempotent. */
export async function removeOverride(
  params: { organizationId: string; roleKey: string; permissionKey: string; actorIdentityId: string; idFactory: () => string },
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  const roleKey = assertValidRoleKey(params.roleKey);
  const permissionKey = assertValidPermissionKey(params.permissionKey);
  const { organizationId } = params;
  const id = organizationRolePermissionOverrideId(organizationId, roleKey, permissionKey);

  return withOrganizationRoleLock(organizationId, dataAdapterMode, async (lockHandle) => {
    const existing = await getOverrideRow(id, dataAdapterMode);
    if (!existing) return;

    await commitProtectedWrite(lockHandle, dataAdapterMode, async () => {
      if (dataAdapterMode === 'mock') {
        const index = organizationRolePermissionOverrideFixtures.findIndex((o) => o.id === id);
        if (index !== -1) organizationRolePermissionOverrideFixtures.splice(index, 1);
      } else {
        await deleteWixDataItem(COLLECTION, id);
      }

      await insertAuditEntry(
        {
          id: params.idFactory(),
          organizationId,
          actorIdentityId: params.actorIdentityId,
          action: 'override_removed',
          roleId: null,
          targetIdentityId: null,
          previousRoleKey: null,
          permissionKey,
        },
        dataAdapterMode,
      );
    });
  });
}

/** Removal by an already-known override id — the DELETE route's own
    entry point, since a client identifies "which override" by id, not by
    the (roleKey, permissionKey) tuple. Re-derives `roleKey`/`permissionKey`
    from the fetched row itself so the audit entry and lock key are
    always correct regardless of what the id string happens to look like. */
export async function removeOverrideById(
  params: { organizationId: string; overrideId: string; actorIdentityId: string; idFactory: () => string },
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  const existing = await getOverrideRow(params.overrideId, dataAdapterMode);
  if (!existing || existing.organizationId !== params.organizationId) {
    // Either it doesn't exist, or it belongs to a different organization —
    // treated identically (a 404-shaped outcome), never distinguished to
    // the caller, so a cross-tenant probe learns nothing either way.
    return;
  }
  await removeOverride(
    { organizationId: params.organizationId, roleKey: existing.roleKey, permissionKey: existing.permissionKey, actorIdentityId: params.actorIdentityId, idFactory: params.idFactory },
    dataAdapterMode,
  );
}
