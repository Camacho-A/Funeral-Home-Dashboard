'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { EmptyState } from '@/components/ui/EmptyState';
import { RoleList } from './RoleList';
import { RoleEditor } from './RoleEditor';
import { AssignRoleDialog } from './AssignRoleDialog';
import { PermissionInspector } from './PermissionInspector';
import { RbacHealthBadge } from './RbacHealthBadge';
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
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5 (design S3): two-column
 * layout (`grid-template-columns:220px minmax(0,1fr)`), renders inside
 * SettingsShell now. "Assign Role" moved below RoleList as "Assign role
 * to member" (same dialog/trigger, new label/placement) — see RoleList.tsx.
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
    return (
      <div className="sx-loading" aria-busy="true">
        <span className="sx-skeleton" style={{ width: '90%' }} />
        <span className="sx-skeleton" style={{ width: '70%' }} />
        <span className="sx-skeleton" style={{ width: '80%' }} />
        <span className="sr-only">Loading roles…</span>
      </div>
    );
  }

  const canManageRoles = (myPermissionsQuery.data?.permissions ?? []).includes('user.manageRoles');

  // Manors go-live hardening: a page/UI guard, not just hiding the
  // "Assign Role" button — this whole page is administrative RBAC
  // configuration (every role's full permission set), gated on the same
  // permission GET /api/rbac/roles now enforces server-side for this
  // specific page. Anyone lacking it (e.g. a manager who can still fetch
  // role data for the Team page's invite picker via canViewRoleCatalog)
  // gets a clean "not authorized" state here instead of an empty/partial
  // Roles page.
  if (!canManageRoles) {
    return <EmptyState message="You don't have access to organization roles for this organization." />;
  }

  const roles = rolesQuery.data ?? [];
  const catalog = catalogQuery.data ?? [];
  const members = membersQuery.data ?? [];

  const activeRoleId = selectedRoleId ?? roles[0]?.id ?? null;
  const activeRole = roles.find((r) => r.id === activeRoleId) ?? null;

  return (
    <div>
      <div className="sx-settings-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h2 className="sx-settings-title">Roles &amp; Permissions</h2>
          <p className="sx-settings-desc">Manage roles and what each one can access.</p>
        </div>
        <RbacHealthBadge organizationId={organizationId} />
      </div>

      <div className={styles.columns}>
        <RoleList
          organizationId={organizationId}
          roles={roles}
          selectedRoleId={activeRoleId}
          onSelect={setSelectedRoleId}
          canManageRoles={canManageRoles}
          onAssignClick={() => setAssignDialogOpen(true)}
        />
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
