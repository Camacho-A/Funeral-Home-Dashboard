'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmActionDialog } from '@/components/settings/ConfirmActionDialog';
import { useSignatureRequestsForDocument, useResendSignatureRequest, useCancelSignatureRequest } from '@/hooks/useSignatureRequests';
import { useCaseActivity } from '@/hooks/useActivity';
import { formatTimestamp } from '@/utils/format';
import { SIGNATURE_REQUEST_STATUS_LABEL, signatureRequestStatusVariant, ACTIVE_SIGNATURE_REQUEST_STATUSES } from '@/domain/signatures/signatureRequestDisplay';
import styles from './SignatureStatusPanel.module.css';

/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). Shows one
 * document's current signature state — the most recent completed
 * `SignatureRecord` if one exists ("Signed by X on Y"), otherwise the
 * current active `SignatureRequest`'s signer/status/timestamps with
 * Resend/Cancel actions — plus a collapsible Signature History section
 * reusing `useCaseActivity` (Phase 24) filtered to this document's
 * `document.signature.*` events, rather than a new history endpoint.
 */
export function SignatureStatusPanel({
  organizationId,
  caseId,
  documentId,
  canRequest,
  canCancel,
}: {
  organizationId: string;
  caseId: string;
  documentId: string;
  canRequest: boolean;
  canCancel: boolean;
}) {
  const query = useSignatureRequestsForDocument(organizationId, caseId, documentId);
  const resend = useResendSignatureRequest(organizationId, caseId, documentId);
  const cancel = useCancelSignatureRequest(organizationId, caseId, documentId);
  const activityQuery = useCaseActivity(caseId, organizationId);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (query.isPending) return <p className={styles.meta}>Loading signature status…</p>;
  if (query.isError) return <p className={styles.error}>Couldn&rsquo;t load signature status.</p>;

  const { requests, records } = query.data;
  const activeRequest = requests.find((r) => ACTIVE_SIGNATURE_REQUEST_STATUSES.includes(r.status)) ?? null;
  const latestRecord = records[0] ?? null;

  const events = activityQuery.data?.pages.flatMap((page) => page.events) ?? [];
  const historyEvents = events.filter((e) => e.resourceType === 'caseDocument' && e.resourceId === documentId && e.eventType.startsWith('document.signature.'));

  async function handleResend(requestId: string) {
    setError(null);
    try {
      await resend.mutateAsync(requestId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend the signature request.');
    }
  }

  return (
    <div className={styles.panel}>
      {latestRecord && (
        <div className={styles.signedLine}>
          Signed by {latestRecord.signerName} on {formatTimestamp(latestRecord.signedAt)}
        </div>
      )}

      {!latestRecord && activeRequest && (
        <>
          <div className={styles.headerRow}>
            <span className={styles.signerLine}>
              {activeRequest.signerName} ({activeRequest.signerEmail})
            </span>
            <Badge variant={signatureRequestStatusVariant(activeRequest.status)}>{SIGNATURE_REQUEST_STATUS_LABEL[activeRequest.status]}</Badge>
          </div>
          <div className={styles.meta}>
            Requested {formatTimestamp(activeRequest.issuedAt)}
            {activeRequest.viewedAt ? ` · Viewed ${formatTimestamp(activeRequest.viewedAt)}` : ''}
            {activeRequest.expiresAt ? ` · Expires ${formatTimestamp(activeRequest.expiresAt)}` : ''}
            {activeRequest.reminderCount > 0 ? ` · Reminded ${activeRequest.reminderCount}x` : ''}
          </div>
          {error && <span className={styles.error}>{error}</span>}
          <div className={styles.actions}>
            {canRequest && (
              <Button variant="secondary" onClick={() => handleResend(activeRequest.id)} disabled={resend.isPending}>
                {resend.isPending ? 'Resending…' : 'Resend'}
              </Button>
            )}
            {canCancel && (
              <Button variant="ghost" onClick={() => setCancellingId(activeRequest.id)}>
                Cancel
              </Button>
            )}
          </div>
        </>
      )}

      {!latestRecord && !activeRequest && requests.length === 0 && <span className={styles.meta}>No signature has been requested for this document yet.</span>}

      {(requests.length > 0 || records.length > 0) && (
        <button type="button" className={styles.historyToggle} onClick={() => setHistoryOpen((open) => !open)}>
          {historyOpen ? 'Hide signature history' : 'Show signature history'}
        </button>
      )}

      {historyOpen && (
        <div className={styles.history}>
          {historyEvents.length === 0 ? (
            <span className={styles.historyEntry}>No signature history recorded yet.</span>
          ) : (
            historyEvents.map((event) => (
              <div key={event.id} className={styles.historyEntry}>
                {event.description} · {formatTimestamp(event.createdAt)}
              </div>
            ))
          )}
        </div>
      )}

      {cancellingId && (
        <ConfirmActionDialog
          open
          onClose={() => setCancellingId(null)}
          title="Cancel Signature Request"
          message="This signature request will be cancelled and its signing link will stop working. This does not delete the document."
          confirmLabel="Cancel Request"
          onConfirm={() => cancel.mutateAsync(cancellingId)}
        />
      )}
    </div>
  );
}
