'use client';

import { useState } from 'react';
import { TextField } from '@/components/ui/TextField';
import type { RbacRole } from '@/lib/identityAuthClient';
import { useCreateCustomRole } from '@/hooks/useRbac';

/**
 * Phase 22 (Role-Based Access Control). The Organization Roles Page's own
 * role list — platform defaults and custom roles side by side, matching
 * the pattern app/(portal)/settings/page.tsx already established
 * (WorkflowTemplateList + WorkflowEditor). "+ New Role" creates an empty
 * custom role with no permissions granted yet; the caller then edits its
 * permission set in the Role Editor, matching "start from nothing" being
 * simpler to reason about than a hidden default permission set.
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5 (design S3): 36px rows, 7px
 * radius, selected row gets `--sx-navy-tint`. "+ New role" moved into the
 * section title as `sx-btn-ghost sx-btn-sm`. "Assign role to member"
 * (the same AssignRoleDialog trigger RoleManagementPanel used to render
 * in its own toolbar) now sits below the list, as `sx-btn-secondary`.
 */
export function RoleList({
  organizationId,
  roles,
  selectedRoleId,
  onSelect,
  canManageRoles,
  onAssignClick,
}: {
  organizationId: string;
  roles: RbacRole[];
  selectedRoleId: string | null;
  onSelect: (roleId: string) => void;
  canManageRoles: boolean;
  onAssignClick: () => void;
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
    <div>
      <h3 className="sx-section-title">
        Roles
        {canManageRoles && !creating && (
          <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" style={{ color: 'var(--sx-link)' }} onClick={() => setCreating(true)}>
            + New role
          </button>
        )}
      </h3>

      {roles.map((role) => (
        <button
          key={role.id}
          type="button"
          onClick={() => onSelect(role.id)}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            height: 36,
            padding: '0 10px',
            border: 'none',
            borderRadius: 7,
            background: role.id === selectedRoleId ? 'var(--sx-navy-tint)' : 'transparent',
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, color: 'var(--sx-text)' }}>{role.name}</span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--sx-muted)' }}>{role.isSystemDefault ? 'Platform default' : 'Custom role'}</span>
        </button>
      ))}

      {canManageRoles && creating && (
        <form onSubmit={handleCreate} style={{ marginTop: 8 }}>
          <TextField
            className="sx-input"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            placeholder="New role name"
            aria-label="New role name"
            autoFocus
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="submit" className="sx-btn sx-btn-primary sx-btn-sm" disabled={createRole.isPending || !newRoleName.trim()}>
              Create
            </button>
            <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {canManageRoles && (
        <button type="button" className="sx-btn sx-btn-secondary" style={{ width: '100%', marginTop: 16 }} onClick={onAssignClick}>
          Assign role to member
        </button>
      )}
    </div>
  );
}
