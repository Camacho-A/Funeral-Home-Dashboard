'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { PendingInvitation } from '@/lib/identityAuthClient';
import { useResendInvitation, useRevokeInvitation } from '@/hooks/useRbac';
import { ConfirmActionDialog } from './ConfirmActionDialog';
import styles from './PendingInvitationList.module.css';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Phase 23 (Team Management). The Team page's pending-invitation list —
 * only rendered at all when the caller can invite (matching this
 * endpoint's own `user.invite` gate) or when there's something to show.
 * `status: 'expired'` (derived server-side from the invitation's latest
 * token) gets its own badge, but behaves identically to `'pending'` for
 * both resend and revoke.
 */
export function PendingInvitationList({
  organizationId,
  invitations,
  canInvite,
}: {
  organizationId: string;
  invitations: PendingInvitation[];
  canInvite: boolean;
}) {
  const resendInvitation = useResendInvitation(organizationId);
  const revokeInvitation = useRevokeInvitation(organizationId);
  const [pendingRevoke, setPendingRevoke] = useState<PendingInvitation | null>(null);

  if (invitations.length === 0) return null;

  return (
    <Card className={styles.card}>
      <h2 className={styles.heading}>Pending invitations</h2>
      <div className={styles.list}>
        {invitations.map((invitation) => (
          <div key={invitation.membershipId} className={styles.row}>
            <div className={styles.identity}>
              <span className={styles.name}>{invitation.displayName}</span>
              <span className={styles.email}>{invitation.email}</span>
            </div>

            <span className={styles.role}>{invitation.role}</span>

            <Badge variant={invitation.status === 'expired' ? 'danger' : 'brand'}>{invitation.status === 'expired' ? 'Expired' : 'Pending'}</Badge>

            <div className={styles.meta}>
              <span>Invited {formatDate(invitation.createdAt)}</span>
              {invitation.lastResentAt && <span>Resent {formatDate(invitation.lastResentAt)}</span>}
              <span>Expires {formatDate(invitation.expiresAt)}</span>
            </div>

            {canInvite && (
              <div className={styles.actions}>
                <Button
                  variant="secondary"
                  onClick={() => resendInvitation.mutate({ membershipId: invitation.membershipId, invitedIdentityId: invitation.identityId })}
                  disabled={resendInvitation.isPending}
                >
                  Resend
                </Button>
                <Button variant="danger" onClick={() => setPendingRevoke(invitation)}>
                  Revoke
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {pendingRevoke && (
        <ConfirmActionDialog
          open
          onClose={() => setPendingRevoke(null)}
          title="Revoke Invitation"
          message={`The invitation sent to ${pendingRevoke.email} will be cancelled and can no longer be accepted.`}
          confirmLabel="Revoke"
          onConfirm={() => revokeInvitation.mutateAsync({ membershipId: pendingRevoke.membershipId })}
        />
      )}
    </Card>
  );
}
