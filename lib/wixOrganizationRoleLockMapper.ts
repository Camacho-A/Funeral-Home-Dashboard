import type { OrganizationRoleLock } from '../types/organizationRoleLock';

export type WixOrganizationRoleLockItem = {
  organizationId?: unknown;
  lockToken?: unknown;
  fenceToken?: unknown;
  lockedAt?: unknown;
  expiresAt?: unknown;
};

export function mapWixOrganizationRoleLockItem(item: WixOrganizationRoleLockItem | undefined): OrganizationRoleLock | null {
  if (
    !item ||
    typeof item.organizationId !== 'string' ||
    typeof item.lockToken !== 'string' ||
    typeof item.fenceToken !== 'number' ||
    typeof item.lockedAt !== 'string' ||
    typeof item.expiresAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.organizationId,
    organizationId: item.organizationId,
    lockToken: item.lockToken,
    fenceToken: item.fenceToken,
    lockedAt: item.lockedAt,
    expiresAt: item.expiresAt,
  };
}

export function buildWixOrganizationRoleLockData(lock: OrganizationRoleLock): WixOrganizationRoleLockItem {
  return {
    organizationId: lock.organizationId,
    lockToken: lock.lockToken,
    fenceToken: lock.fenceToken,
    lockedAt: lock.lockedAt,
    expiresAt: lock.expiresAt,
  };
}
