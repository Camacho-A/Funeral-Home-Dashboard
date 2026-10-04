'use client';

import { useState } from 'react';
import type { PendingInvitation } from '@/lib/identityAuthClient';
import { useResendInvitation, useRevokeInvitation } from '@/hooks/useRbac';
import { ConfirmActionDialog } from './ConfirmActionDialog';

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
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5 (design S2): `.sx-section-title`
 * with a count, then a table (email / invited date if present / role if
 * present / status `.sx-status-warn` "Pending"). "Revoke" stays a
 * VISIBLE `sx-btn-danger sx-btn-sm` action (not in a RowMenu), same confirm.
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
    <section className="sx-settings-section">
      <h3 className="sx-section-title">
        Pending invitations<span className="sx-section-meta">{invitations.length} invitation(s)</span>
      </h3>
      <table className="sx-table sx-table-stack">
        <thead>
          <tr>
            <th>Invitee</th>
            <th>Role</th>
            <th>Status</th>
            <th>Dates</th>
            {canInvite && <th aria-hidden="true"></th>}
          </tr>
        </thead>
        <tbody>
          {invitations.map((invitation) => (
            <tr key={invitation.membershipId}>
              <td data-label="Invitee" data-primary>
                <span className="sx-cell-title">{invitation.displayName}</span>
                <span className="sx-cell-sub">{invitation.email}</span>
              </td>
              <td data-label="Role">{invitation.role}</td>
              <td data-label="Status">
                <span className={invitation.status === 'expired' ? 'sx-status sx-status-bad' : 'sx-status sx-status-warn'}>
                  {invitation.status === 'expired' ? 'Expired' : 'Pending'}
                </span>
              </td>
              <td data-label="Dates" className="sx-mono">
                <span>Invited {formatDate(invitation.createdAt)}</span>
                {invitation.lastResentAt && <span> · Resent {formatDate(invitation.lastResentAt)}</span>}
                <span> · Expires {formatDate(invitation.expiresAt)}</span>
              </td>
              {canInvite && (
                <td data-label="Actions">
                  <div className="sx-row-actions">
                    <button
                      type="button"
                      className="sx-btn sx-btn-secondary sx-btn-sm"
                      onClick={() => resendInvitation.mutate({ membershipId: invitation.membershipId, invitedIdentityId: invitation.identityId })}
                      disabled={resendInvitation.isPending}
                    >
                      Resend
                    </button>
                    <button type="button" className="sx-btn sx-btn-danger sx-btn-sm" onClick={() => setPendingRevoke(invitation)}>
                      Revoke
                    </button>
                    {/* Manors go-live invitation-lifecycle fix (Fix C): a
                        resend failure (wrong membership state, or the email
                        provider rejecting/erroring) must be visible here, not
                        silently swallowed — the mutation already carries the
                        server's real error message. */}
                    {resendInvitation.isError && resendInvitation.variables?.membershipId === invitation.membershipId && (
                      <span className="sx-error" role="alert">
                        {resendInvitation.error instanceof Error ? resendInvitation.error.message : 'Failed to resend invitation.'}
                      </span>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

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
    </section>
  );
}
