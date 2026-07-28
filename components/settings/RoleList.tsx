'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import type { RbacRole } from '@/lib/identityAuthClient';
import { useCreateCustomRole } from '@/hooks/useRbac';
import styles from './RoleList.module.css';

/**
 * Phase 22 (Role-Based Access Control). The Organization Roles Page's own
 * role list — platform defaults and custom roles side by side, matching
 * the pattern app/(portal)/settings/page.tsx already established
 * (WorkflowTemplateList + WorkflowEditor). "+ New Role" creates an empty
 * custom role with no permissions granted yet; the caller then edits its
 * permission set in the Role Editor, matching "start from nothing" being
 * simpler to reason about than a hidden default permission set.
 */
export function RoleList({
  organizationId,
  roles,
  selectedRoleId,
  onSelect,
  canManageRoles,
}: {
  organizationId: string;
  roles: RbacRole[];
  selectedRoleId: string | null;
  onSelect: (roleId: string) => void;
  canManageRoles: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const createRole = useCreateCustomRole(organizationId);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!newRoleName.trim()) return;
    const role = await createRole.mutateAsync({ name: newRoleName.trim(), permissions: [] });
    setNewRoleName('');
    setCreating(false);
    onSelect(role.id);
  }

  return (
    <div className={styles.list}>
      {roles.map((role) => (
        <button
          key={role.id}
          type="button"
          className={[styles.item, role.id === selectedRoleId ? styles.itemActive : ''].filter(Boolean).join(' ')}
          onClick={() => onSelect(role.id)}
        >
          <span className={styles.itemName}>{role.name}</span>
          <span className={styles.itemMeta}>{role.isSystemDefault ? 'Platform default' : 'Custom role'}</span>
        </button>
      ))}

      {canManageRoles && (
        <div className={styles.newRoleForm}>
          {creating ? (
            <form onSubmit={handleCreate}>
              <TextField
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                placeholder="New role name"
                aria-label="New role name"
                autoFocus
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Button type="submit" disabled={createRole.isPending || !newRoleName.trim()}>
                  Create
                </Button>
                <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="secondary" onClick={() => setCreating(true)}>
              + New Role
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
