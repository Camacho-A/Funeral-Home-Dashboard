'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { RoleList } from './RoleList';
import { RoleEditor } from './RoleEditor';
import { AssignRoleDialog } from './AssignRoleDialog';
import { PermissionInspector } from './PermissionInspector';
import { useRoles, usePermissionCatalog, useMyPermissions, useOrganizationMembers } from '@/hooks/useRbac';
import styles from './RoleManagementPanel.module.css';

/**
 * Phase 22 (Role-Based Access Control). "Organization Roles Page" — the
 * orchestration layer, matching the pattern
 * app/(portal)/settings/page.tsx already established for workflow
 * templates: this is the only component here that owns "which role is
 * selected," everything below is presentational/data-fetching-by-id.
 * Only rendered for `AUTH_ADAPTER=identity` — see
 * app/(portal)/settings/roles/page.tsx.
 */
export function RoleManagementPanel() {
  const { organizationId } = useOrganization();
  const rolesQuery = useRoles(organizationId);
  const catalogQuery = usePermissionCatalog();
  const myPermissionsQuery = useMyPermissions(organizationId);
  const membersQuery = useOrganizationMembers(organizationId);

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);

  if (rolesQuery.isPending || catalogQuery.isPending || myPermissionsQuery.isPending) {
    return <p>Loading roles…</p>;
  }

  const roles = rolesQuery.data ?? [];
  const catalog = catalogQuery.data ?? [];
  const members = membersQuery.data ?? [];
  const canManageRoles = (myPermissionsQuery.data?.permissions ?? []).includes('user.manageRoles');

  const activeRoleId = selectedRoleId ?? roles[0]?.id ?? null;
  const activeRole = roles.find((r) => r.id === activeRoleId) ?? null;

  return (
    <div>
      <div className={styles.toolbar}>
        {canManageRoles && (
          <Button variant="secondary" onClick={() => setAssignDialogOpen(true)}>
            Assign Role
          </Button>
        )}
      </div>

      <div className={styles.columns}>
        <RoleList organizationId={organizationId} roles={roles} selectedRoleId={activeRoleId} onSelect={setSelectedRoleId} canManageRoles={canManageRoles} />
        {activeRole ? (
          <RoleEditor
            key={activeRole.id}
            organizationId={organizationId}
            role={activeRole}
            permissionCatalog={catalog}
            canManageRoles={canManageRoles}
            onDeleted={() => setSelectedRoleId(null)}
          />
        ) : (
          <EmptyState message="No roles found." />
        )}
      </div>

      <PermissionInspector organizationId={organizationId} />

      {canManageRoles && (
        <AssignRoleDialog open={assignDialogOpen} onClose={() => setAssignDialogOpen(false)} organizationId={organizationId} members={members} roles={roles} />
      )}
    </div>
  );
}
