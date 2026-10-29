'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { crematoryCaseAction, type CrematoryCaseSummary } from '@/lib/crematoryClient';
import { PREVIOUS_SEND_METHODS } from '@/domain/crematory/previousSend';

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
  onClose,
  onRecorded,
}: {
  organizationId: string;
  summary: CrematoryCaseSummary;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [decision, setDecision] = useState<'sent_outside_solis' | 'not_previously_sent' | null>(null);
  const [method, setMethod] = useState('');
  const [sentOn, setSentOn] = useState('');
  const [verification, setVerification] = useState('');
  const [confirmedChecked, setConfirmedChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete =
    verification.trim().length >= 10 && (decision === 'sent_outside_solis' ? method !== '' : decision === 'not_previously_sent' ? confirmedChecked : false);

  async function record() {
    if (!decision) return;
    setBusy(true);
    setError(null);
    try {
      await crematoryCaseAction(
        organizationId,
        summary.caseId,
        decision === 'sent_outside_solis'
          ? { action: 'record_previous_send', decision, method, sentOn: sentOn || undefined, verification }
          : { action: 'record_previous_send', decision, verification, confirmedChecked },
      );
      onRecorded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This could not be recorded. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title="Verify the previous send">
      <div className="sx-modal-header">
        <h2 className="sx-modal-title">Verify the previous send</h2>
      </div>
      <div className="sx-modal-body">
        <p>
          <strong>{summary.decedentDisplayName}</strong> ({summary.caseNumber}): this case indicates that documents may already have been sent to the crematory outside SOLIS. What do the sending records show?
        </p>
        <fieldset>
          <label>
            <input type="radio" name="previous-send" checked={decision === 'sent_outside_solis'} onChange={() => setDecision('sent_outside_solis')} /> They were already sent outside SOLIS
          </label>
          <br />
          <label>
            <input type="radio" name="previous-send" checked={decision === 'not_previously_sent'} onChange={() => setDecision('not_previously_sent')} /> They were not previously sent
          </label>
        </fieldset>

        {decision === 'sent_outside_solis' && (
          <>
            <label className="sx-label" htmlFor="previous-send-method">
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
            <label className="sx-label" htmlFor="previous-send-date">
              Date sent (if known)
            </label>
            <input id="previous-send-date" type="date" className="sx-input" value={sentOn} onChange={(e) => setSentOn(e.target.value)} />
            <p>This case will not be sent again through Send to Crematory.</p>
          </>
        )}
        {decision && (
          <>
            <label className="sx-label" htmlFor="previous-send-verification">
              {decision === 'sent_outside_solis' ? 'How you verified the earlier send' : 'Which sending records you checked'}
            </label>
            <textarea id="previous-send-verification" className="sx-textarea" rows={3} value={verification} onChange={(e) => setVerification(e.target.value)} />
          </>
        )}
        {decision === 'not_previously_sent' && (
          <label>
            <input type="checkbox" checked={confirmedChecked} onChange={(e) => setConfirmedChecked(e.target.checked)} /> I checked the available sending records and determined these documents were not previously sent to the crematory.
          </label>
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
          {busy ? 'Recording…' : 'Record'}
        </button>
      </div>
    </Modal>
  );
}
