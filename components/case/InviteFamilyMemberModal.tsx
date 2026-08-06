'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { useIssuePortalInvitation } from '@/hooks/usePortal';
import { PORTAL_RELATIONSHIP_TYPES, type PortalRelationshipType } from '@/domain/portal/portalRelationshipRegistry';
import styles from './InviteFamilyMemberModal.module.css';

const IMPLEMENTED_RELATIONSHIP_TYPES = (Object.keys(PORTAL_RELATIONSHIP_TYPES) as PortalRelationshipType[]).filter(
  (key) => PORTAL_RELATIONSHIP_TYPES[key].implemented,
);

/**
 * Phase 29 (Family Portal & External Collaboration). "Invite Family
 * Member" — email, display name, and relationship type, matching
 * `InviteTeamMemberModal.tsx`'s own form pattern exactly. Only the four
 * `implemented: true` relationship types are offered — the reserved five
 * are real `PortalRelationshipType` values but grant zero capabilities
 * today (see `portalRelationshipRegistry.ts`'s own comment), so offering
 * them here would create an invitation nobody could ever meaningfully use.
 * The server (never this component) re-validates and never returns the
 * raw invitation token — it's emailed directly to the invitee.
 */
export function InviteFamilyMemberModal({
  open,
  onClose,
  organizationId,
  caseId,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  caseId: string;
}) {
  const issueInvitation = useIssuePortalInvitation(organizationId, caseId);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [relationshipType, setRelationshipType] = useState<PortalRelationshipType | ''>('');
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setEmail('');
    setDisplayName('');
    setRelationshipType('');
    setError(null);
    onClose();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!email.trim() || !displayName.trim() || !relationshipType) return;
    try {
      await issueInvitation.mutateAsync({ email: email.trim(), displayName: displayName.trim(), relationshipType });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite family member.');
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Invite Family Member">
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="invite-family-email">
            Email
          </label>
          <TextField id="invite-family-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="invite-family-name">
            Display name
          </label>
          <TextField id="invite-family-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="invite-family-relationship">
            Relationship to case
          </label>
          <SelectField
            id="invite-family-relationship"
            value={relationshipType}
            onChange={(e) => setRelationshipType(e.target.value as PortalRelationshipType)}
            required
          >
            <option value="" disabled>
              Select a relationship…
            </option>
            {IMPLEMENTED_RELATIONSHIP_TYPES.map((key) => (
              <option key={key} value={key}>
                {PORTAL_RELATIONSHIP_TYPES[key].displayName}
              </option>
            ))}
          </SelectField>
        </div>

        {error && <span className={styles.error}>{error}</span>}

        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!email.trim() || !displayName.trim() || !relationshipType || issueInvitation.isPending}>
            Send Invite
          </Button>
        </div>
      </form>
    </Modal>
  );
}
