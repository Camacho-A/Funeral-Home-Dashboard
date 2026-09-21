import { isPermissionKey } from '../domain/rbac/permissionCatalog';
import type { OrganizationRolePermissionOverride, OrganizationRolePermissionOverrideAction } from '../types/organizationRolePermissionOverride';

export type WixOrganizationRolePermissionOverrideItem = {
  beaconOverrideId?: unknown;
  organizationId?: unknown;
  roleKey?: unknown;
  permissionKey?: unknown;
  action?: unknown;
  reason?: unknown;
  createdAt?: unknown;
  createdBy?: unknown;
  updatedAt?: unknown;
};

function isValidAction(value: unknown): value is OrganizationRolePermissionOverrideAction {
  return value === 'grant' || value === 'revoke';
}

/**
 * Manors go-live hardening. Mirrors `lib/wixRolePermissionMapper.ts`'s own
 * fail-closed shape exactly: an override with a malformed id/organizationId/
 * roleKey, an unknown/stale `permissionKey`, or an `action` outside the
 * closed `grant`/`revoke` vocabulary is rejected outright — an override
 * this codebase can't unambiguously interpret must never silently apply.
 * `reason` is non-security metadata and normalizes to `null` rather than
 * failing the whole row.
 */
export function mapWixOrganizationRolePermissionOverrideItem(
  item: WixOrganizationRolePermissionOverrideItem | undefined,
): OrganizationRolePermissionOverride | null {
  if (
    !item ||
    typeof item.beaconOverrideId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.roleKey !== 'string' ||
    !isPermissionKey(item.permissionKey) ||
    !isValidAction(item.action) ||
    typeof item.createdAt !== 'string' ||
    typeof item.createdBy !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconOverrideId,
    organizationId: item.organizationId,
    roleKey: item.roleKey,
    permissionKey: item.permissionKey,
    action: item.action,
    reason: typeof item.reason === 'string' ? item.reason : null,
    createdAt: item.createdAt,
    createdBy: item.createdBy,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : item.createdAt,
  };
}

export function buildWixOrganizationRolePermissionOverrideData(
  override: OrganizationRolePermissionOverride,
): WixOrganizationRolePermissionOverrideItem {
  return {
    beaconOverrideId: override.id,
    organizationId: override.organizationId,
    roleKey: override.roleKey,
    permissionKey: override.permissionKey,
    action: override.action,
    reason: override.reason,
    createdAt: override.createdAt,
    createdBy: override.createdBy,
    updatedAt: override.updatedAt,
  };
}
