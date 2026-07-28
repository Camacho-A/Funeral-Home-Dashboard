'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { PermissionMatrix, type PermissionMatrixEntry } from './PermissionMatrix';
import type { RbacRole } from '@/lib/identityAuthClient';
import { useUpdateRole, useDeleteRole, useCloneRole } from '@/hooks/useRbac';
import styles from './RoleEditor.module.css';

/**
 * Phase 22 (Role-Based Access Control). Edits one role: for a platform
 * default, a read-only view of its permission set with a "Clone" action
 * (the only way to customize it — "Platform default roles remain
 * immutable"); for a custom role, an editable name/description and
 * Permission Matrix, plus "Delete" (refused server-side, surfaced here as
 * an error, if the role is still assigned to anyone).
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
    <Card className={styles.editor}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          {editable ? (
            <TextField value={name} onChange={(e) => setName(e.target.value)} aria-label="Role name" />
          ) : (
            <span className={styles.name}>{role.name}</span>
          )}
          <span className={styles.badge}>{role.isSystemDefault ? 'Platform default — immutable' : 'Custom role'}</span>
        </div>
        <div className={styles.actions}>
          {role.isSystemDefault && canManageRoles && (
            <Button variant="secondary" onClick={handleClone} disabled={cloneRole.isPending}>
              Clone
            </Button>
          )}
          {editable && (
            <>
              <Button variant="danger" onClick={handleDelete} disabled={deleteRole.isPending}>
                Delete
              </Button>
              <Button onClick={handleSave} disabled={!isDirty || updateRole.isPending}>
                Save
              </Button>
            </>
          )}
        </div>
      </div>

      {editable ? (
        <TextField value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Role description" placeholder="Description" />
      ) : (
        <p className={styles.description}>{role.description}</p>
      )}

      {error && <span className={styles.error}>{error}</span>}

      <PermissionMatrix permissions={permissionCatalog} grantedKeys={grantedKeys} onToggle={editable ? togglePermission : undefined} />
    </Card>
  );
}
