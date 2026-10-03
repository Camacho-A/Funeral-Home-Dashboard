'use client';

import { useEffect, useState } from 'react';
import { TextField } from '@/components/ui/TextField';
import { PermissionMatrix, type PermissionMatrixEntry } from './PermissionMatrix';
import type { RbacRole } from '@/lib/identityAuthClient';
import { useUpdateRole, useDeleteRole, useCloneRole } from '@/hooks/useRbac';

/**
 * Phase 22 (Role-Based Access Control). Edits one role: for a platform
 * default, a read-only view of its permission set with a "Clone" action
 * (the only way to customize it — "Platform default roles remain
 * immutable"); for a custom role, an editable name/description and
 * Permission Matrix, plus "Delete" (refused server-side, surfaced here as
 * an error, if the role is still assigned to anyone).
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5 (design S3): name/description
 * in a two-column form grid; footer Cancel (implicit — no explicit
 * Cancel button existed before, so none is added) replaced by Delete
 * (ghost-danger) / Save (primary). Permissions render via PermissionMatrix,
 * restyled separately to `.sx-perm-group`/`.sx-perm-row`.
 */
export function RoleEditor({
  organizationId,
  role,
  permissionCatalog,
  canManageRoles,
  onDeleted,
}: {
  organizationId: string;
  role: RbacRole;
  permissionCatalog: PermissionMatrixEntry[];
  canManageRoles: boolean;
  onDeleted: () => void;
}) {
  const updateRole = useUpdateRole(organizationId);
  const deleteRole = useDeleteRole(organizationId);
  const cloneRole = useCloneRole(organizationId);

  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [grantedKeys, setGrantedKeys] = useState(new Set(role.permissions));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(role.name);
    setDescription(role.description);
    setGrantedKeys(new Set(role.permissions));
    setError(null);
  }, [role]);

  const editable = !role.isSystemDefault && canManageRoles;
  const originalKeys = new Set(role.permissions);
  const isDirty = name !== role.name || description !== role.description || grantedKeys.size !== originalKeys.size || [...grantedKeys].some((k) => !originalKeys.has(k));

  function togglePermission(key: string) {
    setGrantedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    const addPermissions = [...grantedKeys].filter((k) => !originalKeys.has(k));
    const removePermissions = [...originalKeys].filter((k) => !grantedKeys.has(k));
    try {
      await updateRole.mutateAsync({ roleId: role.id, name, description, addPermissions, removePermissions });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save role.');
    }
  }

  async function handleDelete() {
    setError(null);
    try {
      await deleteRole.mutateAsync(role.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete role.');
    }
  }

  async function handleClone() {
    setError(null);
    try {
      await cloneRole.mutateAsync({ roleId: role.id, name: `${role.name} (Copy)` });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone role.');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
        <div className="sx-form-grid" style={{ flex: 1 }}>
          <div className="sx-field">
            <span className="sx-label">Name</span>
            {editable ? (
              <TextField className="sx-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Role name" />
            ) : (
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>{role.name}</span>
            )}
          </div>
          <div className="sx-field">
            <span className="sx-label">Status</span>
            <span className="sx-tag">{role.isSystemDefault ? 'Platform default — immutable' : 'Custom role'}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {role.isSystemDefault && canManageRoles && (
          <button type="button" className="sx-btn sx-btn-secondary" onClick={handleClone} disabled={cloneRole.isPending}>
            Clone
          </button>
        )}
        {editable && (
          <>
            <button type="button" className="sx-btn sx-btn-ghost" style={{ color: 'var(--sx-red)' }} onClick={handleDelete} disabled={deleteRole.isPending}>
              Delete
            </button>
            <button type="button" className="sx-btn sx-btn-primary" onClick={handleSave} disabled={!isDirty || updateRole.isPending}>
              Save
            </button>
          </>
        )}
      </div>

      {editable ? (
        <div className="sx-field" style={{ marginBottom: 16 }}>
          <span className="sx-label">Description</span>
          <TextField className="sx-input" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Role description" placeholder="Description" />
        </div>
      ) : (
        <p className="sx-help" style={{ marginBottom: 16 }}>{role.description}</p>
      )}

      {error && (
        <div className="sx-form-banner sx-form-banner-error" role="alert">
          {error}
        </div>
      )}

      <PermissionMatrix permissions={permissionCatalog} grantedKeys={grantedKeys} onToggle={editable ? togglePermission : undefined} />
    </div>
  );
}
