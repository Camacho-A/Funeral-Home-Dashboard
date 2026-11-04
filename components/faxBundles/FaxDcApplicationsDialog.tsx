'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { DocumentPreview } from '@/components/documents/DocumentPreview';
import {
  FaxRequestError,
  faxBundlePdfUrl,
  fetchFaxEligibility,
  newSubmissionId,
  previewFaxBundle,
  sendFaxBundle,
  type FaxBundleView,
  type FaxEligibleCase,
} from '@/lib/faxBundlesClient';
import styles from './FaxDcApplicationsDialog.module.css';

/**
 * Manatee County DC application fax bundles (2026-11).
 *
 *   Select 1 or more cases → Preview one bundle → Send one fax.
 *
 * Staff tick exactly the applications they want; the order they tick is
 * the order in the bundle (and can be changed). Preview builds the one PDF
 * on the server and shows that exact stored file; Send Fax transmits it.
 * No fax number, numbering or confirmation box to fill in — the deliberate
 * Send Fax press and the server's duplicate-send protection are the
 * safeguard.
 */

const shortDate = (localDate: string | null) => (localDate ? new Date(`${localDate}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : null);
const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function FaxDcApplicationsDialog({
  organizationId,
  onClose,
  preselectedCaseIds = [],
}: {
  organizationId: string;
  onClose: () => void;
  preselectedCaseIds?: string[];
}) {
  const queryClient = useQueryClient();
  const eligibility = useQuery({ queryKey: ['faxEligibility', organizationId], queryFn: () => fetchFaxEligibility(organizationId), gcTime: 0, staleTime: 0 });
  const [step, setStep] = useState<'select' | 'preview' | 'sent'>('select');
  const [picked, setPicked] = useState<string[] | null>(null);
  const [bundle, setBundle] = useState<FaxBundleView | null>(null);
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null);
  const [error, setError] = useState<{ message: string; mayHaveSent: boolean } | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const submissionId = useRef(newSubmissionId());

  const cases = useMemo(() => eligibility.data?.cases ?? [], [eligibility.data]);
  const byId = useMemo(() => new Map(cases.map((c) => [c.caseId, c])), [cases]);
  const max = eligibility.data?.maxApplications ?? 20;
  // Until staff change it, the selection is what was ticked on the Cases list (when selectable).
  const selected = picked ?? preselectedCaseIds.filter((id) => byId.get(id)?.available).slice(0, max);
  const setSelected = (next: string[]) => {
    setPicked(next);
    setProblems({});
    setError(null);
  };

  const toggle = (c: FaxEligibleCase, on: boolean) => setSelected(on ? (selected.includes(c.caseId) || selected.length >= max ? selected : [...selected, c.caseId]) : selected.filter((id) => id !== c.caseId));
  const move = (index: number, by: -1 | 1) => {
    const next = [...selected];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    setSelected(next);
  };

  async function preview() {
    setBusy('preview');
    setError(null);
    setProblems({});
    try {
      const built = await previewFaxBundle(organizationId, selected);
      setBundle(built);
      submissionId.current = newSubmissionId();
      setStep('preview');
    } catch (e) {
      if (e instanceof FaxRequestError && e.caseProblems.length > 0) setProblems(Object.fromEntries(e.caseProblems.map((p) => [p.caseId, p.reason])));
      setError({ message: e instanceof Error ? e.message : 'The bundle could not be prepared.', mayHaveSent: false });
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!bundle) return;
    setBusy('send');
    setError(null);
    try {
      const result = await sendFaxBundle(organizationId, bundle.id, submissionId.current);
      setBundle(result.bundle);
      setStep('sent');
      await Promise.all(bundle.items.map((i) => queryClient.invalidateQueries({ queryKey: ['caseFaxHistory', organizationId, i.caseId] })));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The fax could not be sent.';
      const nothingSent = /Nothing was sent/.test(message);
      // A new press after a failure that sent nothing is a new request; one that may have sent never is.
      if (nothingSent) submissionId.current = newSubmissionId();
      setError({ message, mayHaveSent: !nothingSent });
    } finally {
      setBusy(null);
    }
  }

  const title = 'Fax DC Applications';
  const destination = eligibility.data ? `${eligibility.data.destinationName} · Fax ${eligibility.data.destinationFax}` : null;

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <div className="sx-modal-header">
        <h2 className="sx-modal-title">{title}</h2>
        <button type="button" className="sx-icon-btn" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className={`sx-modal-body ${styles.body}`}>
        {eligibility.isPending && <p className={styles.muted}>Loading saved applications…</p>}
        {eligibility.error && (
          <div className="sx-form-banner sx-form-banner-error" role="alert">
            {eligibility.error.message}
          </div>
        )}
        {eligibility.data && !eligibility.data.sendingEnabled && step !== 'sent' && (
          <div className="sx-form-banner sx-form-banner-info" role="status">
            Fax sending isn&rsquo;t turned on yet. You can prepare and preview bundles; Send Fax becomes available once the NuSo setup is verified.
          </div>
        )}
        {error && (
          <div className="sx-form-banner sx-form-banner-error" role="alert">
            {error.message}
          </div>
        )}

        {eligibility.data && step === 'select' && (
          <>
            <p className={styles.destination}>
              To <strong>{destination}</strong>
            </p>
            {cases.length === 0 ? (
              <p className={styles.muted}>No saved Manatee County applications are waiting to be faxed.</p>
            ) : (
              <ul className={styles.cases} aria-label="Saved applications">
                {cases.map((c) => {
                  const position = selected.indexOf(c.caseId);
                  const checked = position >= 0;
                  const full = !checked && selected.length >= max;
                  const reason = problems[c.caseId] ?? c.reason;
                  const target = shortDate(c.targetDate);
                  return (
                    <li key={c.caseId} className={`${styles.case} ${checked ? styles.caseSelected : ''} ${!c.available ? styles.caseUnavailable : ''}`}>
                      <label className={styles.caseLabel}>
                        <input type="checkbox" checked={checked} disabled={!c.available || full} onChange={(e) => toggle(c, e.target.checked)} aria-describedby={reason ? `fax-reason-${c.caseId}` : undefined} />
                        <span className={styles.caseText}>
                          <span className={styles.caseName}>
                            {c.decedentDisplayName} <span className={styles.caseNumber}>{c.caseNumber}</span>
                          </span>
                          <span className={styles.muted}>
                            Application v{c.documentVersion ?? 1}
                            {target ? ` · send by ${target}` : ''}
                          </span>
                        </span>
                        {checked && <span className={styles.badge}>{position + 1}</span>}
                      </label>
                      {reason && (
                        <span id={`fax-reason-${c.caseId}`} className={problems[c.caseId] ? styles.problem : styles.muted}>
                          {reason}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {selected.length > 0 && (
              <section className={styles.order} aria-label="Bundle order">
                <p className={styles.orderTitle}>
                  {plural(selected.length, 'application')} in one fax
                  {selected.length >= max ? ` (the most one bundle can hold)` : ''}
                </p>
                <ol className={styles.orderList}>
                  {selected.map((id, index) => {
                    const c = byId.get(id);
                    return (
                      <li key={id} className={styles.orderItem}>
                        <span className={styles.orderName}>
                          <strong>
                            {index + 1} of {selected.length}
                          </strong>{' '}
                          {c?.decedentDisplayName ?? id}
                        </span>
                        <span className={styles.orderActions}>
                          <button type="button" className="sx-icon-btn" aria-label={`Move ${c?.decedentDisplayName ?? id} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                            ↑
                          </button>
                          <button type="button" className="sx-icon-btn" aria-label={`Move ${c?.decedentDisplayName ?? id} down`} disabled={index === selected.length - 1} onClick={() => move(index, 1)}>
                            ↓
                          </button>
                          <button type="button" className="sx-icon-btn" aria-label={`Remove ${c?.decedentDisplayName ?? id}`} onClick={() => setSelected(selected.filter((x) => x !== id))}>
                            ×
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}
          </>
        )}

        {bundle && step === 'preview' && (
          <>
            <dl className={styles.summary}>
              <div>
                <dt>Bundle</dt>
                <dd>
                  {bundle.reference} · {plural(bundle.applicationCount, 'application')} · {plural(bundle.pageCount, 'page')} · {formatSize(bundle.sizeBytes)}
                </dd>
              </div>
              <div>
                <dt>To</dt>
                <dd>
                  {bundle.destinationName} · Fax {bundle.destinationFax}
                </dd>
              </div>
              <div>
                <dt>From</dt>
                <dd>{bundle.senderAddress ? `${bundle.senderAddress} (Outlook → NuSo)` : <span className={styles.warn}>No Outlook mailbox is connected — Settings → Crematory.</span>}</dd>
              </div>
              <div>
                <dt>Order</dt>
                <dd>
                  <ol className={styles.inlineList}>
                    {bundle.items.map((i) => (
                      <li key={i.caseId}>
                        {i.position} of {bundle.applicationCount} — {i.decedentDisplayName} ({i.caseNumber})
                      </li>
                    ))}
                  </ol>
                </dd>
              </div>
            </dl>
            <div className={styles.preview}>
              <DocumentPreview url={faxBundlePdfUrl(organizationId, bundle.id)} fileName={`${bundle.reference}.pdf`} mimeType="application/pdf" />
            </div>
          </>
        )}

        {bundle && step === 'sent' && (
          <div className="sx-form-banner sx-form-banner-info" role="status">
            <strong>Submitted to NuSo</strong> — bundle {bundle.reference}, {plural(bundle.applicationCount, 'application')}, to {bundle.destinationName} (fax {bundle.destinationFax}). This is not yet confirmed delivery: an Administrator or Manager records it from a case&rsquo;s Documents tab once NuSo reports the result.
          </div>
        )}
      </div>
      <div className="sx-modal-footer">
        {step === 'preview' && (
          <button type="button" className="sx-btn sx-btn-ghost" disabled={busy !== null} onClick={() => (setStep('select'), setError(null))}>
            Back
          </button>
        )}
        <button type="button" className="sx-btn sx-btn-ghost" onClick={onClose}>
          {step === 'sent' ? 'Done' : 'Close'}
        </button>
        {step === 'select' && (
          <button type="button" className="sx-btn sx-btn-primary" disabled={selected.length === 0 || busy !== null} onClick={() => void preview()}>
            {busy === 'preview' ? 'Preparing bundle…' : `Preview bundle${selected.length > 0 ? ` (${selected.length})` : ''}`}
          </button>
        )}
        {step === 'preview' && bundle && (
          <button
            type="button"
            className="sx-btn sx-btn-primary"
            disabled={busy !== null || !bundle.sendingEnabled || !bundle.senderAddress || error?.mayHaveSent === true}
            title={!bundle.sendingEnabled ? 'Fax sending is not turned on yet.' : undefined}
            onClick={() => void send()}
          >
            {busy === 'send' ? 'Sending…' : 'Send Fax'}
          </button>
        )}
      </div>
    </Modal>
  );
}
