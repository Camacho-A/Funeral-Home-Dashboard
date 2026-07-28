import type { Role } from '../types/role';

export type WixRoleItem = {
  beaconRoleId?: unknown;
  key?: unknown;
  name?: unknown;
  description?: unknown;
  organizationId?: unknown;
  isSystemDefault?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function mapWixRoleItem(item: WixRoleItem | undefined): Role | null {
  if (
    !item ||
    typeof item.beaconRoleId !== 'string' ||
    typeof item.key !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.description !== 'string' ||
    typeof item.isSystemDefault !== 'boolean' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconRoleId,
    key: item.key,
    name: item.name,
    description: item.description,
    organizationId: typeof item.organizationId === 'string' ? item.organizationId : null,
    isSystemDefault: item.isSystemDefault,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixRoleData(role: Role): WixRoleItem {
  return {
    beaconRoleId: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    organizationId: role.organizationId,
    isSystemDefault: role.isSystemDefault,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

/** Full-replace update (see wixDataApi's updateWixDataItem doc) — only
    `name`/`description` may ever change on a role once created; `key`,
    `organizationId`, and `isSystemDefault` are immutable for the row's
    lifetime (RoleService enforces this, not this mapper). */
export function applyRoleUpdateToWixData(existing: WixRoleItem, patch: { name?: string; description?: string; updatedAt: string }): WixRoleItem {
  const next = { ...existing };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.description !== undefined) next.description = patch.description;
  next.updatedAt = patch.updatedAt;
  return next;
}
