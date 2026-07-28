import type { PermissionKey } from '../domain/rbac/permissionCatalog';

/**
 * Phase 22 (Role-Based Access Control). One row of the `rolePermissions`
 * Wix collection — a single (role, permission) grant. A `Role`'s full
 * permission set is the collection of every `RolePermission` row whose
 * `roleId` matches it; there is no permission list embedded on `Role`
 * itself, so granting/revoking one permission from a role is a single
 * insert/delete rather than a read-modify-write of an array field.
 */
export type RolePermission = {
  id: string;
  roleId: string;
  permissionKey: PermissionKey;
  createdAt: string;
};
