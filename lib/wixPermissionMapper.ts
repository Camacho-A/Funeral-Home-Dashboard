import { isPermissionKey, type PermissionKey } from '../domain/rbac/permissionCatalog';
import type { Permission } from '../types/permission';

export type WixPermissionItem = {
  beaconPermissionId?: unknown;
  key?: unknown;
  category?: unknown;
  description?: unknown;
  createdAt?: unknown;
};

export function mapWixPermissionItem(item: WixPermissionItem | undefined): Permission | null {
  if (
    !item ||
    typeof item.beaconPermissionId !== 'string' ||
    !isPermissionKey(item.key) ||
    typeof item.category !== 'string' ||
    typeof item.description !== 'string' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconPermissionId,
    key: item.key,
    category: item.category,
    description: item.description,
    createdAt: item.createdAt,
  };
}

export function buildWixPermissionData(permission: Permission): WixPermissionItem {
  return {
    beaconPermissionId: permission.id,
    key: permission.key satisfies PermissionKey,
    category: permission.category,
    description: permission.description,
    createdAt: permission.createdAt,
  };
}
