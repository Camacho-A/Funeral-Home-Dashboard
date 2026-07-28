'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import type { RbacRole } from '@/lib/identityAuthClient';
import { useInviteTeamMember } from '@/hooks/useRbac';
import styles from './InviteTeamMemberModal.module.css';

/**
 * Phase 23 (Team Management). "Invite Team Member" — email, display name,
 * and role, matching `AssignRoleDialog.tsx`'s own form pattern exactly.
 * The server (never this component) re-validates the role actually
 * resolves for this organization and that the caller may invite at all.
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
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="invite-team-email">
            Email
          </label>
          <TextField id="invite-team-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="invite-team-name">
            Display name
          </label>
          <TextField id="invite-team-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="invite-team-role">
            Role
          </label>
          <SelectField id="invite-team-role" value={role} onChange={(e) => setRole(e.target.value)} required>
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

        {error && <span className={styles.error}>{error}</span>}

        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!email.trim() || !displayName.trim() || !role || inviteTeamMember.isPending}>
            Send Invite
          </Button>
        </div>
      </form>
    </Modal>
  );
}
