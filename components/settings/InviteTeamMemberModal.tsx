'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import type { RbacRole } from '@/lib/identityAuthClient';
import { useInviteTeamMember } from '@/hooks/useRbac';

/**
 * Phase 23 (Team Management). "Invite Team Member" — email, display name,
 * and role, matching `AssignRoleDialog.tsx`'s own form pattern exactly.
 * The server (never this component) re-validates the role actually
 * resolves for this organization and that the caller may invite at all.
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5 (design S2): restyled with the
 * previous phase's form system (§3.3) — same fields/validation/handler.
 */
export function InviteTeamMemberModal({
  open,
  onClose,
  organizationId,
  roles,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  roles: RbacRole[];
}) {
  const inviteTeamMember = useInviteTeamMember(organizationId);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setEmail('');
    setDisplayName('');
    setRole('');
    setError(null);
    onClose();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!email.trim() || !displayName.trim() || !role) return;
    try {
      await inviteTeamMember.mutateAsync({ email: email.trim(), displayName: displayName.trim(), role });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite team member.');
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Invite Team Member">
      <div className="sx-modal-header">
        <h2 className="sx-modal-title">Invite Team Member</h2>
        <button type="button" className="sx-icon-btn" onClick={handleClose} aria-label="Close">
          ×
        </button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="sx-modal-body">
          <div className="sx-form-grid">
            <div className="sx-field sx-span-all">
              <label className="sx-label" htmlFor="invite-team-email">
                Email
              </label>
              <TextField className="sx-input" id="invite-team-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>

            <div className="sx-field sx-span-all">
              <label className="sx-label" htmlFor="invite-team-name">
                Display name
              </label>
              <TextField className="sx-input" id="invite-team-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </div>

            <div className="sx-field sx-span-all">
              <label className="sx-label" htmlFor="invite-team-role">
                Role
              </label>
              <SelectField className="sx-select" id="invite-team-role" value={role} onChange={(e) => setRole(e.target.value)} required>
                <option value="" disabled>
                  Select a role…
                </option>
                {roles.map((r) => (
                  <option key={r.id} value={r.key}>
                    {r.name}
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
          <button type="button" className="sx-btn sx-btn-ghost" onClick={handleClose}>
            Cancel
          </button>
          <button type="submit" className="sx-btn sx-btn-primary" disabled={!email.trim() || !displayName.trim() || !role || inviteTeamMember.isPending}>
            Send Invite
          </button>
        </div>
      </form>
    </Modal>
  );
}
