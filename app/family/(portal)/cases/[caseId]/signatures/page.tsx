'use client';

import { use, useState } from 'react';
import { useFamilySignatureRequests, useCompleteFamilySignature, useDeclineFamilySignature } from '@/hooks/useFamilyPortal';
import { FamilyCaseNav } from '@/components/family/FamilyCaseNav';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/format';
import styles from '@/components/family/FamilyCaseSection.module.css';

const ACTIONABLE_STATUSES = new Set(['pending', 'viewed']);

/**
 * Phase 29 (Family Portal & External Collaboration). Complete or decline
 * a signature request — `signedName` is the signer's typed name (the same
 * "type your name" consent pattern the staff-facing `/sign` page already
 * uses), not a drawn signature. Only `pending`/`viewed` requests show
 * actions; every terminal status is display-only.
 */
export default function FamilySignaturesPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  const requestsQuery = useFamilySignatureRequests(caseId);
  const completeSignature = useCompleteFamilySignature(caseId);
  const declineSignature = useDeclineFamilySignature(caseId);

  const [signingRequestId, setSigningRequestId] = useState<string | null>(null);
  const [signedName, setSignedName] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (requestsQuery.isPending) return <p className={styles.loading}>Loading signature requests…</p>;
  if (requestsQuery.isError) return <p className={styles.errorText}>Couldn&rsquo;t load signature requests. Please try again.</p>;

  const requests = requestsQuery.data ?? [];

  async function handleComplete(requestId: string) {
    setError(null);
    if (!signedName.trim()) return;
    try {
      await completeSignature.mutateAsync({ requestId, signedName: signedName.trim() });
      setSigningRequestId(null);
      setSignedName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete signature.');
    }
  }

  async function handleDecline(requestId: string) {
    setError(null);
    try {
      await declineSignature.mutateAsync({ requestId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decline signature request.');
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Signatures</h1>
      <FamilyCaseNav caseId={caseId} />

      {error && <p className={styles.errorText}>{error}</p>}

      {requests.length === 0 ? (
        <EmptyState message="No signature requests for this case." />
      ) : (
        <Card className={styles.listCard}>
          {requests.map((request) => {
            const isActionable = ACTIONABLE_STATUSES.has(request.status);
            const isSigning = signingRequestId === request.id;
            return (
              <div key={request.id} className={`${styles.row} ${styles.rowStack}`}>
                <div className={`${styles.row} ${styles.rowInline}`}>
                  <div className={styles.identity}>
                    <span className={styles.title}>Document Signature</span>
                    <span className={styles.meta}>Requested {formatTimestamp(request.issuedAt)}</span>
                  </div>
                  <Badge variant={request.status === 'signed' ? 'success' : request.status === 'declined' || request.status === 'expired' || request.status === 'cancelled' ? 'danger' : 'brand'}>
                    {request.status}
                  </Badge>
                  {isActionable && !isSigning && (
                    <div className={styles.actions}>
                      <Button onClick={() => setSigningRequestId(request.id)}>Sign</Button>
                      <Button variant="ghost" onClick={() => handleDecline(request.id)} disabled={declineSignature.isPending}>
                        Decline
                      </Button>
                    </div>
                  )}
                </div>
                {isSigning && (
                  <div className={styles.actionsSpaced}>
                    <TextField placeholder="Type your full name to sign" value={signedName} onChange={(e) => setSignedName(e.target.value)} autoFocus />
                    <Button onClick={() => handleComplete(request.id)} disabled={!signedName.trim() || completeSignature.isPending}>
                      Confirm Signature
                    </Button>
                    <Button variant="ghost" onClick={() => setSigningRequestId(null)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
