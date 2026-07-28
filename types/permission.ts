import type { PermissionKey } from '../domain/rbac/permissionCatalog';

export type { PermissionKey };

/**
 * Phase 22 (Role-Based Access Control). One row of the `permissions` Wix
 * collection — a materialized, queryable copy of
 * `domain/rbac/permissionCatalog.ts`'s static `PERMISSION_KEYS`, seeded
 * once and never written to by ordinary application logic. Exists so the
 * Permission Matrix / Permission Inspector UI can list and describe every
 * permission from data rather than needing to import the domain constant
 * on the client, and so a future permission could be added by data
 * migration alone.
 */
export type Permission = {
  id: string;
  key: PermissionKey;
  category: string;
  description: string;
  createdAt: string;
};
