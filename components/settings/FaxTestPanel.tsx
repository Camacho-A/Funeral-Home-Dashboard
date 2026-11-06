'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { fetchFaxTests, recordFaxTestOutcome, sendFaxTest, type FaxTestOverview, type FaxTestView } from '@/lib/faxTestsClient';
import { FAX_TEST_STATUS_LABEL, faxTestAttachmentName, type EmailDryRunCheck, type FaxTestStatus, type FaxTestStep } from '@/domain/faxBundles/faxTest';
import { formatTimestamp } from '@/utils/format';
import styles from './FaxTestPanel.module.css';

/**
 * Fax test transmissions (2026-11) — Settings → Fax Settings, administrators
 * only. Sends a FICTIONAL test PDF to an approved test recipient through the
 * exact Send Fax path, so the business can see what NuSo and Exchange do to
 * it before real faxing is turned on. Real DC application bundles are never
 * involved. Each send is confirmed here; the server re-checks everything.
 */
const newSubmissionId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `sub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
const when = (iso: string | null) => (iso ? formatTimestamp(iso) : '—');

export function FaxTestPanel({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['faxTests', organizationId], queryFn: () => fetchFaxTests(organizationId) });
  const [confirming, setConfirming] = useState<{ step: FaxTestStep; recipientKey: string } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['faxTests', organizationId] });

  if (query.isPending) return <p className="sx-help">Loading fax tests…</p>;
  if (query.error || !query.data) return <div className="sx-form-banner sx-form-banner-error" role="alert"><span>{query.error?.message ?? 'Fax tests could not be loaded.'}</span></div>;
  const data = query.data;
  const open = data.transmissions.find((t) => t.id === data.openTransmissionId) ?? null;

  return (
    <div className={styles.panel}>
      {notice && (
        <div className={`sx-form-banner ${notice.ok ? styles.success : 'sx-form-banner-error'}`} role={notice.ok ? 'status' : 'alert'}>
          <span>{notice.message}</span>
        </div>
      )}
      <p className={styles.lead}>
        Sends a <strong>fictional</strong> test PDF — no case data — to an approved test recipient through exactly the path Send Fax uses (the connected Outlook mailbox, an empty plain-text body, one PDF), to check what NuSo and Exchange do to it. Real DC application faxing stays {data.sendingEnabled ? 'on' : 'off'}; tests never send a real bundle.
      </p>

      {!data.enabled ? (
        <div className={`sx-form-banner ${styles.off}`} role="status">
          <span>
            <strong>Test transmissions are off.</strong> No approved test recipients are configured. They are added in SOLIS’s code only for an approved test — a fax number the business controls, and an email address for the dry run — and removed afterwards.
            {data.invalidRecipients > 0 ? ` ${data.invalidRecipients} configured recipient(s) are not valid and were ignored.` : ''}
          </span>
        </div>
      ) : (
        <>
          <dl className={styles.facts}>
            <div>
              <dt>Sent from</dt>
              <dd>{data.mailbox.connected ? data.mailbox.accountEmail : <span className={styles.warn}>No Outlook mailbox is connected (Settings → Crematory).</span>}</dd>
            </div>
            <div>
              <dt>Approved recipients</dt>
              <dd>{data.recipients.map((r) => `${r.display} (${r.kind === 'fax' ? 'fax' : 'dry-run email'})`).join(' · ')}</dd>
            </div>
          </dl>
          <ol className={styles.steps}>
            {data.steps.map((s) => {
              const choices = data.recipients.filter((r) => r.kind === s.kind);
              return (
                <li key={s.step} className={`${styles.step} ${s.passed ? styles.stepPassed : ''}`}>
                  <div className={styles.stepText}>
                    <span className={styles.stepTitle}>
                      Step {s.step}: {s.label}
                      {s.passed && <span className={styles.passTag}>Passed</span>}
                    </span>
                    <span className="sx-help">{s.reason ?? (open ? 'Waiting: record how the open test ended first.' : `${s.pages}-page fictional PDF to ${choices.map((c) => c.display).join(' or ')}.`)}</span>
                  </div>
                  <button
                    type="button"
                    className="sx-btn sx-btn-secondary sx-btn-sm"
                    disabled={!s.available || open !== null || !data.mailbox.connected || choices.length === 0}
                    onClick={() => {
                      setNotice(null);
                      setConfirming({ step: s.step, recipientKey: choices[0].key });
                    }}
                  >
                    Send test…
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {open && <OpenTest key={`${open.id}-${open.revision}`} organizationId={organizationId} test={open} data={data} onDone={(message, ok) => (setNotice({ ok, message }), void refresh())} />}

      {data.transmissions.length > 0 && (
        <section aria-label="Test history" className={styles.history}>
          <h3 className={styles.subTitle}>Test history</h3>
          <ol className={styles.historyList}>
            {data.transmissions.map((t) => (
              <li key={t.id}>
                <span>
                  <strong>Step {t.step}</strong> · {t.kind === 'fax' ? `${t.pages}-page fax` : 'email dry run'} to {t.recipientDisplay} — {t.statusLabel}
                  {t.passed === true && <span className={styles.passTag}>Passed</span>}
                  {t.passed === false && <span className={styles.failTag}>Did not pass</span>}
                </span>
                <span className="sx-help">
                  Outlook contacted {when(t.outlookContactedAt)} · submitted {when(t.submittedAt)}
                  {t.kind === 'fax' ? ` · NuSo accepted ${when(t.nusoAcceptedAt)}` : ''} · result {when(t.outcomeAt)}
                  {t.pagesReceived !== null ? ` · ${t.pagesReceived} of ${t.pages} page(s) received` : ''}
                  {t.nusoReference ? ` · NuSo ref ${t.nusoReference}` : ''}
                  {t.note ? ` · “${t.note}”` : ''}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {confirming && (
        <ConfirmSend
          organizationId={organizationId}
          data={data}
          step={confirming.step}
          recipientKey={confirming.recipientKey}
          onClose={() => setConfirming(null)}
          onSent={(message, ok) => {
            setConfirming(null);
            setNotice({ ok, message });
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function ConfirmSend({ organizationId, data, step, recipientKey: initialKey, onClose, onSent }: { organizationId: string; data: FaxTestOverview; step: FaxTestStep; recipientKey: string; onClose: () => void; onSent: (message: string, ok: boolean) => void }) {
  const spec = data.steps[step];
  const choices = data.recipients.filter((r) => r.kind === spec.kind);
  const [recipientKey, setRecipientKey] = useState(initialKey);
  const recipient = choices.find((r) => r.key === recipientKey) ?? choices[0];
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One submission id per confirmation: a double click or a retried request is the same submission.
  const submissionId = useRef(newSubmissionId());

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const result = await sendFaxTest(organizationId, { step, recipientKey: recipient.key, submissionId: submissionId.current, confirm: { acknowledged: true, recipient: recipient.display, pages: spec.pages } });
      onSent(result.duplicate ? 'This test was already sent — nothing was sent again.' : `Submitted to Outlook. This is not delivery: record what ${spec.kind === 'fax' ? 'NuSo and the receiving line report' : 'the dry-run mailbox received'} below.`, true);
    } catch (e) {
      // Never retried from here; a new attempt is a new confirmation.
      onSent(e instanceof Error ? e.message : 'The test could not be sent.', false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? () => undefined : onClose} title={`Send test step ${step}?`}>
      <div className={styles.confirm}>
        <h2 className={styles.confirmTitle}>Send test step {step}?</h2>
        <dl className={styles.confirmFacts}>
          <div>
            <dt>Test</dt>
            <dd>{spec.label}</dd>
          </div>
          <div>
            <dt>To</dt>
            <dd>
              {choices.length > 1 ? (
                <select className="sx-select" aria-label="Recipient" value={recipient.key} onChange={(e) => (setRecipientKey(e.target.value), setAcknowledged(false))}>
                  {choices.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.display}
                    </option>
                  ))}
                </select>
              ) : (
                <strong>{recipient.display}</strong>
              )}
            </dd>
          </div>
          <div>
            <dt>Attachment</dt>
            <dd>
              {faxTestAttachmentName(spec.pages)} — {spec.pages} fictional page{spec.pages > 1 ? 's' : ''}
              <span className={styles.mono}>SHA-256 {data.expectedChecksums[spec.pages]}</span>
            </dd>
          </div>
          <div>
            <dt>From</dt>
            <dd>{data.mailbox.accountEmail} — empty plain-text body, one PDF</dd>
          </div>
        </dl>
        {error && <div className="sx-form-banner sx-form-banner-error" role="alert"><span>{error}</span></div>}
        <label className={styles.ack}>
          <input type="checkbox" checked={acknowledged} disabled={busy} onChange={(e) => setAcknowledged(e.target.checked)} />
          <span>
            I confirm sending a {spec.pages}-page fictional test {spec.kind === 'fax' ? 'fax' : 'email'} to {recipient.display}. It is sent once and never retried automatically.
          </span>
        </label>
        <div className={styles.confirmActions}>
          <button type="button" className="sx-btn sx-btn-ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="sx-btn sx-btn-primary" disabled={!acknowledged || busy} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send test'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function OpenTest({ organizationId, test, data, onDone }: { organizationId: string; test: FaxTestView; data: FaxTestOverview; onDone: (message: string, ok: boolean) => void }) {
  const [status, setStatus] = useState<FaxTestStatus | ''>('');
  const [pagesReceived, setPagesReceived] = useState('');
  const [nusoReference, setNusoReference] = useState('');
  const [note, setNote] = useState('');
  const [checks, setChecks] = useState<Record<EmailDryRunCheck, boolean>>(() => Object.fromEntries(data.dryRunChecks.map((c) => [c.key, false])) as Record<EmailDryRunCheck, boolean>);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deliveredFax = status === 'delivered' && test.kind === 'fax';
  const deliveredEmail = status === 'delivered' && test.kind === 'email_dry_run';
  const ready = useMemo(() => status !== '' && (!deliveredFax || /^\d{1,2}$/.test(pagesReceived)) && (status !== 'not_sent' || note.trim() !== ''), [status, deliveredFax, pagesReceived, note]);

  async function record() {
    if (!status) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await recordFaxTestOutcome(organizationId, test.id, {
        status,
        expectedRevision: test.revision,
        ...(deliveredFax ? { pagesReceived: Number(pagesReceived) } : {}),
        ...(deliveredEmail ? { checks } : {}),
        ...(nusoReference.trim() ? { nusoReference: nusoReference.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onDone(saved.status === 'delivered' ? (saved.passed ? `Step ${saved.step} passed.` : `Step ${saved.step} did not pass — see the history.`) : `Recorded: ${saved.statusLabel}.`, saved.passed !== false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The result could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${styles.open} ${test.status === 'needs_review' ? styles.openReview : ''}`} aria-labelledby="fax-test-open">
      <h3 id="fax-test-open" className={styles.subTitle}>
        Open test — step {test.step}: {test.kind === 'fax' ? `${test.pages}-page fax` : 'email dry run'} to {test.recipientDisplay}
      </h3>
      <p className={styles.openStatus}>
        <strong>{test.statusLabel}.</strong>{' '}
        {test.status === 'needs_review'
          ? `It may have been sent. It is never retried. Check Sent Items in ${test.senderAddress}${test.kind === 'fax' ? ' and NuSo' : ''}, then record what happened.`
          : 'No other test can be sent until you record how this one ended.'}
      </p>
      <dl className={styles.stages}>
        <div><dt>Outlook contacted</dt><dd>{when(test.outlookContactedAt)}</dd></div>
        <div><dt>Submitted to Outlook</dt><dd>{when(test.submittedAt)}</dd></div>
        {test.kind === 'fax' && <div><dt>Accepted by NuSo</dt><dd>{when(test.nusoAcceptedAt)}</dd></div>}
        <div><dt>{test.kind === 'fax' ? 'Delivered / failed' : 'Received / failed'}</dt><dd>{when(test.outcomeAt)}</dd></div>
        <div><dt>Subject</dt><dd className={styles.break}>{test.subject}</dd></div>
        <div><dt>Attachment</dt><dd className={styles.break}>{test.attachmentName} · SHA-256 {test.pdfChecksumSha256}</dd></div>
        {test.internetMessageId && <div><dt>Message ID</dt><dd className={styles.break}>{test.internetMessageId}</dd></div>}
      </dl>
      <fieldset className={styles.record} disabled={busy}>
        <legend className={styles.subTitle}>Record what happened</legend>
        <div className={styles.choices}>
          {test.next.map((s) => (
            <label key={s} className={styles.choice}>
              <input type="radio" name={`outcome-${test.id}`} value={s} checked={status === s} onChange={() => setStatus(s)} />
              {s === 'delivered' && test.kind === 'email_dry_run' ? 'Received — inspected' : FAX_TEST_STATUS_LABEL[s]}
            </label>
          ))}
        </div>
        {deliveredFax && (
          <div className="sx-field">
            <label className="sx-label" htmlFor={`pages-${test.id}`}>Pages actually received (count every page, including any cover or text page)</label>
            <input id={`pages-${test.id}`} className="sx-input" inputMode="numeric" value={pagesReceived} onChange={(e) => setPagesReceived(e.target.value.replace(/\D/g, '').slice(0, 2))} />
            <span className="sx-help">Passes only if exactly {test.pages}.</span>
          </div>
        )}
        {deliveredEmail && (
          <div className={styles.checks}>
            <span className="sx-help">Open the email’s original source. Tick each check that held; an unticked check means it did not pass.</span>
            {data.dryRunChecks.map((c) => (
              <label key={c.key} className={styles.choice}>
                <input type="checkbox" checked={checks[c.key]} onChange={(e) => setChecks({ ...checks, [c.key]: e.target.checked })} />
                {c.label}
              </label>
            ))}
          </div>
        )}
        {test.kind === 'fax' && (status === 'nuso_accepted' || status === 'delivered' || status === 'failed') && (
          <div className="sx-field">
            <label className="sx-label" htmlFor={`ref-${test.id}`}>NuSo reference (optional)</label>
            <input id={`ref-${test.id}`} className="sx-input" maxLength={100} value={nusoReference} onChange={(e) => setNusoReference(e.target.value)} />
          </div>
        )}
        {status !== '' && (
          <div className="sx-field">
            <label className="sx-label" htmlFor={`note-${test.id}`}>{status === 'not_sent' ? 'How you confirmed nothing was sent (required)' : 'Note (optional)'}</label>
            <input id={`note-${test.id}`} className="sx-input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
        {error && <div className="sx-form-banner sx-form-banner-error" role="alert"><span>{error}</span></div>}
        <div>
          <button type="button" className="sx-btn sx-btn-primary sx-btn-sm" disabled={!ready || busy} onClick={() => void record()}>
            {busy ? 'Saving…' : 'Record result'}
          </button>
        </div>
      </fieldset>
    </section>
  );
}
