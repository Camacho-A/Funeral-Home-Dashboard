'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SelectField } from '@/components/ui/SelectField';
import type { RbacRole, RbacMember } from '@/lib/identityAuthClient';
import { useAssignRole } from '@/hooks/useRbac';

/**
 * Phase 22 (Role-Based Access Control). "Assign Role Dialog" — picks a
 * member of the organization and a role to grant them. The server (never
 * this component) re-validates that the caller may manage roles and that
 * the target role actually resolves for this organization; a rejected
 * request surfaces its message here rather than the dialog assuming
 * success.
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5 (design S3): restyled with
 * the previous phase's form system (§3.3) — same fields/validation/handler.
 *
 * Raw role display fix (2026-10): the member picker's "— currently X"
 * text used to render `member.role` (the internal key) directly — now
 * looks it up against the `roles` prop already passed in here, same
 * `roles.find((r) => r.key === ...)?.name ?? ...` pattern established
 * by TeamMemberList. `member.role` itself and the actual role-assignment
 * submission are unchanged.
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
      <div className="sx-modal-header">
        <h2 className="sx-modal-title">Assign Role</h2>
        <button type="button" className="sx-icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="sx-modal-body">
          <div className="sx-form-grid">
            <div className="sx-field sx-span-all">
              <label className="sx-label" htmlFor="assign-role-member">
                Member
              </label>
              <SelectField className="sx-select" id="assign-role-member" value={targetIdentityId} onChange={(e) => setTargetIdentityId(e.target.value)} required>
                <option value="" disabled>
                  Select a member…
                </option>
                {members.map((member) => (
                  <option key={member.identityId} value={member.identityId}>
                    {member.displayName} — currently {roles.find((r) => r.key === member.role)?.name ?? member.role}
                  </option>
                ))}
              </SelectField>
            </div>

            <div className="sx-field sx-span-all">
              <label className="sx-label" htmlFor="assign-role-role">
                Role
              </label>
              <SelectField className="sx-select" id="assign-role-role" value={roleKey} onChange={(e) => setRoleKey(e.target.value)} required>
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
          </div>

          {error && (
            <div className="sx-form-banner sx-form-banner-error" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="sx-modal-footer">
          <button type="button" className="sx-btn sx-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="sx-btn sx-btn-primary" disabled={!targetIdentityId || !roleKey || assignRole.isPending}>
            Assign
          </button>
        </div>
      </form>
    </Modal>
  );
}
