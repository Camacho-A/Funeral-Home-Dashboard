'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { crematoryCaseAction, type CrematoryCaseSummary } from '@/lib/crematoryClient';
import { PREVIOUS_SEND_METHODS } from '@/domain/crematory/previousSend';
import styles from './PreviousSendDialog.module.css';

/**
 * Verify a possible earlier send (2026-10). Workflow 3 says "Permit sent to
 * crematory" but SOLIS never sent this case, so staff record what actually
 * happened before it can be sent — never a one-click acknowledgment:
 *   A. sent outside SOLIS — how, when if known, and how they verified it;
 *      the case is then never sent through the first send;
 *   B. not previously sent — they confirm they checked the sending records
 *      and say which.
 * Recorded once, with who and when, in the case activity. Nothing is sent.
 */
export function PreviousSendDialog({
  organizationId,
  summary,
  correcting = false,
  onClose,
  onRecorded,
}: {
  organizationId: string;
  summary: CrematoryCaseSummary;
  /** An administrator correcting the recorded answer (2026-10): a reason is required. */
  correcting?: boolean;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [decision, setDecision] = useState<'sent_outside_solis' | 'not_previously_sent' | null>(null);
  const [method, setMethod] = useState('');
  const [sentOn, setSentOn] = useState('');
  const [verification, setVerification] = useState('');
  const [confirmedChecked, setConfirmedChecked] = useState(false);
  const [reason, setReason] = useState('');
  const recorded = summary.previousSend?.recorded ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete =
    verification.trim().length >= 10 &&
    (!correcting || reason.trim().length >= 10) &&
    (decision === 'sent_outside_solis' ? method !== '' : decision === 'not_previously_sent' ? confirmedChecked : false);

  async function record() {
    if (!decision) return;
    setBusy(true);
    setError(null);
    try {
      const answer =
        decision === 'sent_outside_solis' ? { decision, method, sentOn: sentOn || undefined, verification } : { decision, verification, confirmedChecked };
      await crematoryCaseAction(organizationId, summary.caseId, correcting ? { action: 'correct_previous_send', reason, ...answer } : { action: 'record_previous_send', ...answer });
      onRecorded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This could not be recorded. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title={correcting ? 'Correct the earlier-send record' : 'Verify the previous send'}>
      <div className="sx-modal-header">
        <h2 className="sx-modal-title">{correcting ? 'Correct the earlier-send record' : 'Verify the previous send'}</h2>
      </div>
      <div className="sx-modal-body">
        {correcting && recorded && (
          <p>
            Recorded now: <strong>{recorded.decision === 'sent_outside_solis' ? 'already sent outside SOLIS' : 'not previously sent'}</strong> ({recorded.verification}). The current
            answer and every earlier one are kept; your correction and its reason are recorded in the case activity.
          </p>
        )}
        <p>
          <strong>{summary.decedentDisplayName}</strong> ({summary.caseNumber}): this case indicates that documents may already have been sent to the crematory outside SOLIS.
        </p>
        <fieldset className={styles.choices}>
          <legend className={styles.legend}>What do the sending records show?</legend>
          <label className={styles.choice}>
            <input type="radio" name="previous-send" checked={decision === 'sent_outside_solis'} onChange={() => setDecision('sent_outside_solis')} />
            They were already sent outside SOLIS
          </label>
          <label className={styles.choice}>
            <input type="radio" name="previous-send" checked={decision === 'not_previously_sent'} onChange={() => setDecision('not_previously_sent')} />
            They were not previously sent
          </label>
        </fieldset>

        {decision === 'sent_outside_solis' && (
          <>
            <div className={styles.field}>
              <label className={styles.legend} htmlFor="previous-send-method">
                How they were sent
              </label>
              <select id="previous-send-method" className="sx-input" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">Choose…</option>
                {Object.entries(PREVIOUS_SEND_METHODS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.legend} htmlFor="previous-send-date">
                Date sent (if known)
              </label>
              <input id="previous-send-date" type="date" className="sx-input" value={sentOn} onChange={(e) => setSentOn(e.target.value)} />
            </div>
            <p className={styles.note}>This case will not be sent again through Send to Crematory.</p>
          </>
        )}
        {decision && (
          <div className={styles.field}>
            <label className={styles.legend} htmlFor="previous-send-verification">
              {decision === 'sent_outside_solis' ? 'How you verified the earlier send' : 'Which sending records you checked'}
            </label>
            <textarea id="previous-send-verification" className="sx-textarea" rows={3} value={verification} onChange={(e) => setVerification(e.target.value)} />
          </div>
        )}
        {decision === 'not_previously_sent' && (
          <div className={styles.field}>
            <label className={styles.confirm}>
              <input type="checkbox" checked={confirmedChecked} onChange={(e) => setConfirmedChecked(e.target.checked)} />
              I checked the available sending records and determined these documents were not previously sent to the crematory.
            </label>
          </div>
        )}
        {correcting && (
          <div className={styles.field}>
            <label className={styles.legend} htmlFor="previous-send-reason">
              Why the record is being corrected
            </label>
            <textarea id="previous-send-reason" className="sx-textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        {error && (
          <div className="sx-form-banner sx-form-banner-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="sx-modal-footer">
        <button type="button" className="sx-btn sx-btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="sx-btn sx-btn-primary" onClick={() => void record()} disabled={busy || !complete}>
          {busy ? 'Recording…' : correcting ? 'Record correction' : 'Record'}
        </button>
      </div>
    </Modal>
  );
}
