'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { fetchCaseFaxHistory, recordFaxOutcome, type CaseFaxHistoryEntry } from '@/lib/faxBundlesClient';
import styles from './CaseFaxStatus.module.css';

/**
 * Manatee County DC application fax bundles (2026-11) — one line on the
 * case's Documents tab: which bundle this case's application went out in
 * (its place in it) and where that fax stands. Earlier bundles are behind
 * "History". Members with fax.confirm record what NuSo reported.
 */

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null);
const TONE: Record<CaseFaxHistoryEntry['state'], 'ok' | 'warn' | ''> = {
  ready: '',
  sending: '',
  submitted: '',
  delivered: 'ok',
  failed: 'warn',
  needs_review: 'warn',
  discarded: '',
  expired: '',
};

export const caseFaxHistoryKey = (organizationId: string, caseId: string) => ['caseFaxHistory', organizationId, caseId] as const;

export function CaseFaxStatus({ organizationId, caseId, canRecordOutcome }: { organizationId: string; caseId: string; canRecordOutcome: boolean }) {
  const history = useQuery({ queryKey: caseFaxHistoryKey(organizationId, caseId), queryFn: () => fetchCaseFaxHistory(organizationId, caseId) });
  const [recording, setRecording] = useState<CaseFaxHistoryEntry | null>(null);
  const entries = history.data ?? [];
  if (entries.length === 0) return null;
  const [latest, ...earlier] = entries;
  const tone = TONE[latest.state];

  const line = (e: CaseFaxHistoryEntry) =>
    `${e.reference} · application ${e.position} of ${e.applicationCount}${e.state === 'delivered' && e.deliveredAt ? ` · delivered ${when(e.deliveredAt)}` : e.submittedAt ? ` · sent ${when(e.submittedAt)}` : ''}`;

  return (
    <section className={styles.panel} aria-label="DC Application Fax">
      <div className={styles.head}>
        <h3 className={styles.title}>DC Application Fax</h3>
        <span className={`sx-status ${tone === 'ok' ? 'sx-status-ok' : tone === 'warn' ? 'sx-status-warn' : ''}`}>{latest.stateLabel}</span>
      </div>
      <p className={styles.detail}>{line(latest)}</p>
      {latest.state === 'needs_review' && <p className={styles.note}>This fax may have gone out. It is never sent again automatically — check NuSo and Sent Items, then record what happened.</p>}
      {latest.state === 'failed' && latest.failureMessage && <p className={styles.note}>{latest.failureMessage}</p>}
      {canRecordOutcome && (latest.state === 'submitted' || latest.state === 'needs_review') && (
        <div>
          <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" onClick={() => setRecording(latest)}>
            Record delivery result
          </button>
        </div>
      )}
      {earlier.length > 0 && (
        <details className={styles.history}>
          <summary>History ({earlier.length})</summary>
          <ul>
            {earlier.map((e) => (
              <li key={e.bundleId}>
                {line(e)} — {e.stateLabel}
              </li>
            ))}
          </ul>
        </details>
      )}
      {recording && <RecordOutcomeDialog organizationId={organizationId} entry={recording} onClose={() => setRecording(null)} />}
    </section>
  );
}

const nowForInput = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function RecordOutcomeDialog({ organizationId, entry, onClose }: { organizationId: string; entry: CaseFaxHistoryEntry; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [deliveredAt, setDeliveredAt] = useState(nowForInput());
  const [nusoReference, setNusoReference] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'delivered' | 'failed' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function record(decision: 'delivered' | 'failed') {
    setBusy(decision);
    setError(null);
    try {
      const result = await recordFaxOutcome(organizationId, entry.bundleId, {
        decision,
        deliveredAt: decision === 'delivered' && deliveredAt ? new Date(deliveredAt).toISOString() : undefined,
        nusoReference: nusoReference.trim() || undefined,
        note: note.trim() || undefined,
        confirmation: file,
      });
      await Promise.all([
        ...result.bundle.items.map((i) => queryClient.invalidateQueries({ queryKey: caseFaxHistoryKey(organizationId, i.caseId) })),
        queryClient.invalidateQueries({ queryKey: ['case', organizationId] }),
      ]);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The result could not be recorded.');
    } finally {
      setBusy(null);
    }
  }

  const title = `Fax ${entry.reference} — delivery result`;
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="sx-modal-header">
        <h2 className="sx-modal-title">{title}</h2>
        <button type="button" className="sx-icon-btn" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className={`sx-modal-body ${styles.form}`}>
        <p className={styles.detail}>
          Record what NuSo reported for this bundle ({entry.applicationCount === 1 ? '1 application' : `${entry.applicationCount} applications`}). It applies to every case in it. NuSo should report exactly {entry.pageCount === 1 ? '1 page' : `${entry.pageCount} pages`}; if it reports more, a cover or text page was added — say so in the note.
        </p>
        {error && (
          <div className="sx-form-banner sx-form-banner-error" role="alert">
            {error}
          </div>
        )}
        <label className="sx-label" htmlFor="fax-delivered-at">
          Delivered at
        </label>
        <input id="fax-delivered-at" type="datetime-local" className="sx-input" value={deliveredAt} max={nowForInput()} onChange={(e) => setDeliveredAt(e.target.value)} />
        <label className="sx-label" htmlFor="fax-nuso-reference">
          NuSo reference (optional)
        </label>
        <input id="fax-nuso-reference" className="sx-input" value={nusoReference} maxLength={100} onChange={(e) => setNusoReference(e.target.value)} />
        <label className="sx-label" htmlFor="fax-note">
          Note (optional)
        </label>
        <input id="fax-note" className="sx-input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        <label className="sx-label" htmlFor="fax-confirmation">
          NuSo confirmation (optional)
        </label>
        <input id="fax-confirmation" type="file" accept=".pdf,.eml,.png,.jpg,.jpeg,.txt,application/pdf,message/rfc822,image/png,image/jpeg,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div className="sx-modal-footer">
        <button type="button" className="sx-btn sx-btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="sx-btn sx-btn-secondary" disabled={busy !== null} onClick={() => void record('failed')}>
          {busy === 'failed' ? 'Saving…' : 'Not delivered'}
        </button>
        <button type="button" className="sx-btn sx-btn-primary" disabled={busy !== null || !deliveredAt} onClick={() => void record('delivered')}>
          {busy === 'delivered' ? 'Saving…' : 'Delivered'}
        </button>
      </div>
    </Modal>
  );
}
