'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/SelectField';
import type { RbacRole, RbacMember } from '@/lib/identityAuthClient';
import { useAssignRole } from '@/hooks/useRbac';
import styles from './AssignRoleDialog.module.css';

/**
 * Phase 22 (Role-Based Access Control). "Assign Role Dialog" — picks a
 * member of the organization and a role to grant them. The server (never
 * this component) re-validates that the caller may manage roles and that
 * the target role actually resolves for this organization; a rejected
 * request surfaces its message here rather than the dialog assuming
 * success.
 */
export function AssignRoleDialog({
  open,
  onClose,
  organizationId,
  members,
  roles,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  members: RbacMember[];
  roles: RbacRole[];
}) {
  const assignRole = useAssignRole(organizationId);
  const [targetIdentityId, setTargetIdentityId] = useState('');
  const [roleKey, setRoleKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!targetIdentityId || !roleKey) return;
    try {
      await assignRole.mutateAsync({ targetIdentityId, roleKey });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign role.');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Assign Role">
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="assign-role-member">
            Member
          </label>
          <SelectField id="assign-role-member" value={targetIdentityId} onChange={(e) => setTargetIdentityId(e.target.value)} required>
            <option value="" disabled>
              Select a member…
            </option>
            {members.map((member) => (
              <option key={member.identityId} value={member.identityId}>
                {member.displayName} — currently {member.role}
              </option>
            ))}
          </SelectField>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="assign-role-role">
            Role
          </label>
          <SelectField id="assign-role-role" value={roleKey} onChange={(e) => setRoleKey(e.target.value)} required>
            <option value="" disabled>
              Select a role…
            </option>
            {roles.map((role) => (
              <option key={role.id} value={role.key}>
                {role.name}
              </option>
            ))}
          </SelectField>
        </div>

        {error && <span className={styles.error}>{error}</span>}

        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!targetIdentityId || !roleKey || assignRole.isPending}>
            Assign
          </Button>
        </div>
      </form>
    </Modal>
  );
}
