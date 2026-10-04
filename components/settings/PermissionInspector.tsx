'use client';

import { Card } from '@/components/ui/Card';
import { PermissionMatrix } from './PermissionMatrix';
import { useMyPermissions, usePermissionCatalog, useRoles } from '@/hooks/useRbac';
import styles from './PermissionInspector.module.css';

/**
 * Phase 22 (Role-Based Access Control). "Permission Inspector
 * (developer/admin utility)" — shows exactly what the *current session*
 * is resolved to, read straight from the server
 * (`GET /api/rbac/my-permissions`), never computed client-side. Useful
 * for confirming a role change actually took effect, or for support/
 * debugging ("why can't I see the Payments tab") without needing direct
 * data access.
 *
 * Raw role display fix (2026-10): the "role: X" line used to render the
 * raw `roleKey` (e.g. "officeStaff") directly — now resolved against the
 * same canonical `RbacRole[]` list (`useRoles`, id/key/name) every other
 * role display in Settings already uses, via the same
 * `roles.find((r) => r.key === ...)?.name ?? ...` fallback pattern. The
 * underlying `roleKey` value itself (and everything the permission
 * matrix below it reads) is unchanged.
 */
export function PermissionInspector({ organizationId }: { organizationId: string }) {
  const catalogQuery = usePermissionCatalog();
  const myPermissionsQuery = useMyPermissions(organizationId);
  const rolesQuery = useRoles(organizationId);

  if (catalogQuery.isPending || myPermissionsQuery.isPending) return null;

  const catalog = catalogQuery.data ?? [];
  const granted = new Set(myPermissionsQuery.data?.permissions ?? []);
  const roleKey = myPermissionsQuery.data?.roleKey;
  const roles = rolesQuery.data ?? [];
  const roleLabel = roles.find((r) => r.key === roleKey)?.name ?? roleKey;

  return (
    <Card className={styles.inspector}>
      <div className={styles.heading}>
        <span className={styles.title}>Your effective permissions</span>
        <span className={styles.roleKey}>role: {roleLabel}</span>
      </div>
      <PermissionMatrix permissions={catalog} grantedKeys={granted} />
    </Card>
  );
}
