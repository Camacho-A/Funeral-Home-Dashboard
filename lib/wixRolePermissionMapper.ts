import { isPermissionKey } from '../domain/rbac/permissionCatalog';
import type { RolePermission } from '../types/rolePermission';

export type WixRolePermissionItem = {
  beaconRolePermissionId?: unknown;
  roleId?: unknown;
  permissionKey?: unknown;
  createdAt?: unknown;
};

/**
 * Phase 38 (RBAC Grant Hygiene & Authorization Integrity). Sentinel used
 * when a persisted grant row is missing a valid `createdAt`. `createdAt` is
 * incidental persistence metadata — it is *never* read by any authorization
 * decision (that is pure `Set.has(permissionKey)`, see
 * `services/permissionService.ts`). Historically the mapper required it as a
 * `typeof === 'string'` guard, so a legitimate grant seeded without a
 * `createdAt` (e.g. by an early live-verification script) was silently
 * mapped to `null`, filtered out, and resolved to *absent → false* — a valid
 * permission revoked purely because of missing non-security metadata. Phase
 * 38 makes that non-fatal: the grant maps through with this sentinel rather
 * than vanishing. The security-critical fields (`beaconRolePermissionId`,
 * `roleId`, `permissionKey`) remain fail-closed. The live rows carrying this
 * defect are also repaired by the Phase 38 reconciliation backfill, so the
 * sentinel path is a durable safety net, not the primary data state.
 */
export const ROLE_PERMISSION_CREATED_AT_FALLBACK = '1970-01-01T00:00:00.000Z';

export function mapWixRolePermissionItem(item: WixRolePermissionItem | undefined): RolePermission | null {
  // Security-critical fields fail closed: a grant with a malformed id, a
  // malformed roleId, or a permissionKey not in the current catalog is
  // rejected outright (an unknown/stale key must never resolve to an
  // authorization, and a malformed id/roleId breaks tenant/role scoping).
  if (
    !item ||
    typeof item.beaconRolePermissionId !== 'string' ||
    typeof item.roleId !== 'string' ||
    !isPermissionKey(item.permissionKey)
  ) {
    return null;
  }

  // Non-security metadata (`createdAt`) is normalized, never fatal.
  const createdAt = typeof item.createdAt === 'string' ? item.createdAt : ROLE_PERMISSION_CREATED_AT_FALLBACK;

  return {
    id: item.beaconRolePermissionId,
    roleId: item.roleId,
    permissionKey: item.permissionKey,
    createdAt,
  };
}

export function buildWixRolePermissionData(rolePermission: RolePermission): WixRolePermissionItem {
  return {
    beaconRolePermissionId: rolePermission.id,
    roleId: rolePermission.roleId,
    permissionKey: rolePermission.permissionKey,
    createdAt: rolePermission.createdAt,
  };
}
