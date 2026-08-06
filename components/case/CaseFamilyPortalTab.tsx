'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { usePortalInvitations, useRevokePortalInvitation, usePortalAccess, useSetPortalAccessAction, usePortalMessages, useSendPortalStaffMessage } from '@/hooks/usePortal';
import { useCaseDocumentLibrary, useSetCaseDocumentFamilyVisibility } from '@/hooks/useCaseDocumentLibrary';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { EmptyState } from '@/components/ui/EmptyState';
import { TextArea } from '@/components/ui/TextArea';
import { ConfirmActionDialog } from '@/components/settings/ConfirmActionDialog';
import { InviteFamilyMemberModal } from './InviteFamilyMemberModal';
import { PORTAL_INVITATION_STATUS_LABEL, portalInvitationStatusVariant, PORTAL_ACCESS_STATUS_LABEL, portalAccessStatusVariant } from '@/domain/portal/portalDisplay';
import { PORTAL_RELATIONSHIP_TYPES } from '@/domain/portal/portalRelationshipRegistry';
import { isTerminalPortalAccessStatus, type PortalAccess } from '@/types/portalAccess';
import { formatTimestamp } from '@/utils/format';
import styles from './CaseFamilyPortalTab.module.css';

/**
 * Phase 29 (Family Portal & External Collaboration). The Case Detail
 * page's "Family Portal" tab — the same self-fetching `{ caseId }`-only
 * shape as `CaseScheduleTab.tsx`/`CaseDocumentsTab.tsx`. Four sections:
 * pending invitations, current access grants, document family-visibility,
 * and messaging — gated by the two Phase 29 staff permissions
 * (`portal.manage` for the first three, `portal.message` for the last),
 * following `CaseScheduleTab.tsx`'s exact fail-open-while-pending
 * `permissions === null || permissions.includes(...)` convention (the
 * tab itself already proves view access via its own data queries
 * succeeding, so a still-loading permissions call must not incorrectly
 * hide every action).
 *
 * The Family Access section deliberately shows only `relationshipType`/
 * `status`/dates for each grant, never an email or display name —
 * `GET .../portal-access` returns the capability-grant shape only, per
 * the approved plan's own route table (`GET .../portal-invitations`
 * intentionally returns *pending* invitations only, which is where an
 * invitee's email/displayName actually lives, pre-acceptance).
 */
export function CaseFamilyPortalTab({ caseId }: { caseId: string }) {
  const { organizationId } = useOrganization();
  const invitationsQuery = usePortalInvitations(organizationId, caseId);
  const accessQuery = usePortalAccess(organizationId, caseId);
  const documentsQuery = useCaseDocumentLibrary(organizationId, caseId);
  const messagesQuery = usePortalMessages(organizationId, caseId);
  const myPermissionsQuery = useMyPermissions(organizationId);

  const revokeInvitation = useRevokePortalInvitation(organizationId, caseId);
  const setAccessAction = useSetPortalAccessAction(organizationId, caseId);
  const setFamilyVisible = useSetCaseDocumentFamilyVisibility(organizationId, caseId);
  const sendMessage = useSendPortalStaffMessage(organizationId, caseId);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [revokingInvitationId, setRevokingInvitationId] = useState<string | null>(null);
  const [accessAction, setAccessActionTarget] = useState<{ access: PortalAccess; action: 'disable' | 'revoke' } | null>(null);
  const [messageBody, setMessageBody] = useState('');
  const [messageError, setMessageError] = useState<string | null>(null);

  if (invitationsQuery.isPending || accessQuery.isPending) return <p className={styles.loading}>Loading Family Portal…</p>;
  if (invitationsQuery.isError || accessQuery.isError) return <p className={styles.errorText}>Couldn&rsquo;t load Family Portal access. Please try again.</p>;

  const permissions = myPermissionsQuery.isSuccess ? myPermissionsQuery.data.permissions : null;
  const canManagePortal = permissions === null || permissions.includes('portal.manage');
  const canSendPortalMessage = permissions === null || permissions.includes('portal.message');

  const invitations = invitationsQuery.data ?? [];
  const access = accessQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const messages = messagesQuery.data ?? [];

  async function handleSendMessage(event: React.FormEvent) {
    event.preventDefault();
    setMessageError(null);
    if (!messageBody.trim()) return;
    try {
      await sendMessage.mutateAsync(messageBody.trim());
      setMessageBody('');
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : 'Failed to send message.');
    }
  }

  return (
    <div className={styles.card}>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Pending Invitations</h3>
          {canManagePortal && <Button onClick={() => setInviteOpen(true)}>Invite Family Member</Button>}
        </div>
        {invitations.length === 0 ? (
          <EmptyState message="No pending Family Portal invitations for this case." />
        ) : (
          <Card className={styles.listCard}>
            {invitations.map((invitation) => (
              <div key={invitation.id} className={styles.row}>
                <div className={styles.identity}>
                  <span className={styles.title}>{invitation.displayName}</span>
                  <span className={styles.meta}>
                    {invitation.email} · {PORTAL_RELATIONSHIP_TYPES[invitation.relationshipType].displayName} · expires {formatTimestamp(invitation.expiresAt)}
                  </span>
                </div>
                <Badge variant={portalInvitationStatusVariant(invitation.status)}>{PORTAL_INVITATION_STATUS_LABEL[invitation.status]}</Badge>
                {canManagePortal && (
                  <div className={styles.actions}>
                    <Button variant="ghost" onClick={() => setRevokingInvitationId(invitation.id)}>
                      Revoke
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </Card>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Family Access</h3>
        {access.length === 0 ? (
          <EmptyState message="No one has Family Portal access to this case yet." />
        ) : (
          <Card className={styles.listCard}>
            {access.map((a) => {
              const isTerminal = isTerminalPortalAccessStatus(a.status);
              return (
                <div key={a.id} className={styles.row}>
                  <div className={styles.identity}>
                    <span className={styles.title}>{PORTAL_RELATIONSHIP_TYPES[a.relationshipType].displayName}</span>
                    <span className={styles.meta}>Granted {formatTimestamp(a.createdAt)}</span>
                  </div>
                  <Badge variant={portalAccessStatusVariant(a.status)}>{PORTAL_ACCESS_STATUS_LABEL[a.status]}</Badge>
                  {canManagePortal && !isTerminal && (
                    <div className={styles.actions}>
                      {a.status === 'active' && (
                        <Button variant="secondary" onClick={() => setAccessActionTarget({ access: a, action: 'disable' })}>
                          Disable
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => setAccessActionTarget({ access: a, action: 'revoke' })}>
                        Revoke
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Document Visibility</h3>
        {documents.length === 0 ? (
          <EmptyState message="No documents for this case yet." />
        ) : (
          <Card className={styles.listCard}>
            {documents.map((doc) => (
              <div key={doc.id} className={styles.row}>
                <div className={styles.identity}>
                  <span className={styles.title}>{doc.fileName}</span>
                  <span className={styles.meta}>{formatTimestamp(doc.createdAt)}</span>
                </div>
                <label className={styles.checkboxLabel}>
                  <Checkbox
                    checked={doc.familyVisible}
                    disabled={!canManagePortal || setFamilyVisible.isPending}
                    aria-label={`Family-visible: ${doc.fileName}`}
                    onChange={() => setFamilyVisible.mutate({ documentId: doc.id, familyVisible: !doc.familyVisible })}
                  />
                  Visible to family
                </label>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Messages</h3>
        {messages.length === 0 ? (
          <EmptyState message="No messages with the family for this case yet." />
        ) : (
          <Card className={styles.listCard}>
            {messages.map((message) => (
              <div key={message.id} className={styles.messageRow}>
                <div className={styles.messageMeta}>
                  <span className={styles.title}>{message.senderType === 'staff' ? 'Staff' : 'Family'}</span>
                  <span className={styles.meta}>{formatTimestamp(message.createdAt)}</span>
                </div>
                <p className={styles.messageBody}>{message.body}</p>
              </div>
            ))}
          </Card>
        )}
        {canSendPortalMessage && (
          <form className={styles.messageForm} onSubmit={handleSendMessage}>
            <TextArea
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              placeholder="Send a message to the family…"
              maxLength={5000}
              rows={3}
            />
            {messageError && <span className={styles.errorText}>{messageError}</span>}
            <div className={styles.actions}>
              <Button type="submit" disabled={!messageBody.trim() || sendMessage.isPending}>
                Send
              </Button>
            </div>
          </form>
        )}
      </section>

      <InviteFamilyMemberModal open={inviteOpen} onClose={() => setInviteOpen(false)} organizationId={organizationId} caseId={caseId} />

      {revokingInvitationId && (
        <ConfirmActionDialog
          open
          onClose={() => setRevokingInvitationId(null)}
          title="Revoke Invitation"
          message="This invitation will no longer be usable. The linked access grant will also be revoked."
          confirmLabel="Revoke Invitation"
          onConfirm={async () => {
            await revokeInvitation.mutateAsync(revokingInvitationId);
          }}
        />
      )}

      {accessAction && (
        <ConfirmActionDialog
          open
          onClose={() => setAccessActionTarget(null)}
          title={accessAction.action === 'disable' ? 'Disable Access' : 'Revoke Access'}
          message={
            accessAction.action === 'disable'
              ? 'This person will lose Family Portal access until re-enabled. This can be reversed.'
              : 'This person will permanently lose Family Portal access to this case. This cannot be undone.'
          }
          confirmLabel={accessAction.action === 'disable' ? 'Disable Access' : 'Revoke Access'}
          onConfirm={async () => {
            await setAccessAction.mutateAsync({ accessId: accessAction.access.id, action: accessAction.action });
          }}
        />
      )}
    </div>
  );
}
