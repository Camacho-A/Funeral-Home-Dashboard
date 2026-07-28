import { isPermissionKey } from '../domain/rbac/permissionCatalog';
import type { RolePermission } from '../types/rolePermission';

export type WixRolePermissionItem = {
  beaconRolePermissionId?: unknown;
  roleId?: unknown;
  permissionKey?: unknown;
  createdAt?: unknown;
};

export function mapWixRolePermissionItem(item: WixRolePermissionItem | undefined): RolePermission | null {
  if (
    !item ||
    typeof item.beaconRolePermissionId !== 'string' ||
    typeof item.roleId !== 'string' ||
    !isPermissionKey(item.permissionKey) ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconRolePermissionId,
    roleId: item.roleId,
    permissionKey: item.permissionKey,
    createdAt: item.createdAt,
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
