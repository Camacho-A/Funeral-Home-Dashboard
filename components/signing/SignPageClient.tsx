'use client';

import { useState } from 'react';
import { useSigningPageContext, useCompleteSigning, useDeclineSigning } from '@/hooks/useSigning';
import { buildSigningDocumentUrl } from '@/lib/signingClient';
import styles from './SignPageClient.module.css';

const TERMINAL_STATUS_MESSAGE: Record<string, string> = {
  signed: 'This document has already been signed. No further action is needed.',
  declined: 'This signature request was declined.',
  expired: 'This signing link has expired. Please contact the funeral home for a new one.',
  cancelled: 'This signature request was cancelled by the funeral home.',
};

/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). The public
 * signing experience — authenticated purely by `token`, never a Beacon
 * session (see `services/signatureService.ts`'s own header comment). A
 * typed, attested signature (not a canvas/drawn-signature widget) is this
 * phase's deliberate scope boundary — see ADR-030's "Extension points."
 */
export function SignPageClient({ token }: { token: string }) {
  const contextQuery = useSigningPageContext(token);
  const complete = useCompleteSigning(token);
  const decline = useDeclineSigning(token);

  const [signedName, setSignedName] = useState('');
  const [initials, setInitials] = useState('');
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  if (contextQuery.isPending) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.subtitle}>Loading…</p>
        </div>
      </div>
    );
  }

  if (contextQuery.isError) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Signing link unavailable</h1>
          <p className={styles.error}>{contextQuery.error instanceof Error ? contextQuery.error.message : 'This signing link is invalid or has expired.'}</p>
        </div>
      </div>
    );
  }

  const context = contextQuery.data;

  if (complete.isSuccess) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Signed</h1>
          <p className={styles.status}>Thank you, {context.signerName}. Your signature has been recorded.</p>
        </div>
      </div>
    );
  }

  if (decline.isSuccess) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Declined</h1>
          <p className={styles.status}>You&rsquo;ve declined to sign this document. The funeral home has been notified.</p>
        </div>
      </div>
    );
  }

  if (context.status !== 'pending' && context.status !== 'viewed') {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>{context.documentFileName}</h1>
          <p className={styles.status}>{TERMINAL_STATUS_MESSAGE[context.status] ?? 'This signing link is no longer active.'}</p>
        </div>
      </div>
    );
  }

  async function handleSign() {
    if (!signedName.trim() || !consentAcknowledged) return;
    setActionError(null);
    try {
      await complete.mutateAsync({ signedName: signedName.trim(), initials: initials.trim() || undefined, consentAcknowledged: true });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to record your signature. Please try again.');
    }
  }

  async function handleDecline() {
    setActionError(null);
    try {
      await decline.mutateAsync({ reason: declineReason.trim() || undefined });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to record your response. Please try again.');
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div>
          <h1 className={styles.title}>{context.documentFileName}</h1>
          <p className={styles.subtitle}>
            {context.organizationName} · {context.decedentName}
          </p>
        </div>

        <div className={styles.documentFrame}>
          <iframe src={buildSigningDocumentUrl(token)} title={context.documentFileName} />
        </div>

        {actionError && <span className={styles.error}>{actionError}</span>}

        <div className={styles.form}>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="sign-name">
                Type your full name to sign
              </label>
              <input id="sign-name" className={styles.input} value={signedName} onChange={(e) => setSignedName(e.target.value)} required />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="sign-initials">
                Initials (optional)
              </label>
              <input id="sign-initials" className={styles.input} value={initials} onChange={(e) => setInitials(e.target.value)} />
            </div>
          </div>

          <label className={styles.consentRow}>
            <input type="checkbox" checked={consentAcknowledged} onChange={(e) => setConsentAcknowledged(e.target.checked)} />
            <span>I have reviewed this document and agree that typing my name above constitutes my legal signature.</span>
          </label>

          <div className={styles.actions}>
            <button type="button" className={styles.declineButton} onClick={() => setDeclining((open) => !open)} disabled={complete.isPending || decline.isPending}>
              Decline
            </button>
            <button type="button" className={styles.signButton} onClick={handleSign} disabled={!signedName.trim() || !consentAcknowledged || complete.isPending}>
              {complete.isPending ? 'Signing…' : 'Sign'}
            </button>
          </div>

          {declining && (
            <div className={styles.declinePanel}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="decline-reason">
                  Reason (optional)
                </label>
                <input id="decline-reason" className={styles.input} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.declineButton} onClick={() => setDeclining(false)} disabled={decline.isPending}>
                  Cancel
                </button>
                <button type="button" className={styles.signButton} onClick={handleDecline} disabled={decline.isPending}>
                  {decline.isPending ? 'Submitting…' : 'Confirm decline'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
