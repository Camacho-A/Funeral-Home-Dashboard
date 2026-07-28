'use client';

import { Card } from '@/components/ui/Card';
import { PermissionMatrix } from './PermissionMatrix';
import { useMyPermissions, usePermissionCatalog } from '@/hooks/useRbac';
import styles from './PermissionInspector.module.css';

/**
 * Phase 22 (Role-Based Access Control). "Permission Inspector
 * (developer/admin utility)" — shows exactly what the *current session*
 * is resolved to, read straight from the server
 * (`GET /api/rbac/my-permissions`), never computed client-side. Useful
 * for confirming a role change actually took effect, or for support/
 * debugging ("why can't I see the Payments tab") without needing direct
 * data access.
 */
export function PermissionInspector({ organizationId }: { organizationId: string }) {
  const catalogQuery = usePermissionCatalog();
  const myPermissionsQuery = useMyPermissions(organizationId);

  if (catalogQuery.isPending || myPermissionsQuery.isPending) return null;

  const catalog = catalogQuery.data ?? [];
  const granted = new Set(myPermissionsQuery.data?.permissions ?? []);

  return (
    <Card className={styles.inspector}>
      <div className={styles.heading}>
        <span className={styles.title}>Your effective permissions</span>
        <span className={styles.roleKey}>role: {myPermissionsQuery.data?.roleKey}</span>
      </div>
      <PermissionMatrix permissions={catalog} grantedKeys={granted} />
    </Card>
  );
}
