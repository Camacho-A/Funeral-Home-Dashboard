'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import {
  crematoryCaseAction,
  CrematoryRequestError,
  fetchCrematoryOverview,
  sendToCrematory,
  type CrematoryCaseSummary,
  type CrematorySendResult,
} from '@/lib/crematoryClient';
import { buildCaseDocumentDownloadUrl, extractArrangementPage, uploadCaseDocument } from '@/lib/caseDocumentsClient';
import { assignAttachmentFileNames, crematoryEmailSubject, crematoryPackageFileName, defaultCrematoryMessage, toCaseDate } from '@/domain/crematory/crematoryPackage';
import { parseRecipientList } from '@/domain/crematory/crematorySettings';
import { formatTimestamp } from '@/utils/format';
import { caseDocumentsKey } from '@/hooks/useCaseDocumentLibrary';
import styles from './SendToCrematoryDialog.module.css';

/**
 * Send to Crematory (2026-10). Prepare → review → send, for one case (from
 * the case page) or several (from the Cases page). Every case shows exactly
 * what it still needs, with the action that fixes it right there; only a
 * ready case can be selected. Nothing is sent until the staff member has
 * reviewed the recipients, subject, message and attachments and confirmed.
 * "Submitted" is what Outlook reports — never "delivered".
 */
const PERMIT_TYPE = 'cremation_form.state_permit';

/** Whether SOLIS can bring this case's page 3 or package up to date from
    what is already on it (2026-10) — never for a case already sent. */
function needsPreparation(c: CrematoryCaseSummary): boolean {
  if (c.lastSubmission?.status === 'submitted' || c.lastSubmission?.status === 'uncertain') return false;
  const form = c.readiness.requirements.find((r) => r.key === 'crematory_form');
  return (form !== undefined && !form.ok) || (c.readiness.readyToBuild && !c.package?.current);
}

type Step = 'prepare' | 'review' | 'done';

export function SendToCrematoryDialog({
  open,
  onClose,
  organizationId,
  caseId,
  preselectedCaseIds,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  /** The case page's own case — only it is shown, already selected. */
  caseId?: string;
  /** Cases already ticked on the Cases page — selected if they are ready. */
  preselectedCaseIds?: string[];
}) {
  const queryClient = useQueryClient();
  const queryKey = ['crematory', organizationId, caseId ?? 'all'];
  const overview = useQuery({ queryKey, queryFn: () => fetchCrematoryOverview(organizationId, caseId), enabled: open });
  const [selected, setSelected] = useState<string[]>(caseId ? [caseId] : (preselectedCaseIds ?? []));
  const [step, setStep] = useState<Step>('prepare');
  const [busyCase, setBusyCase] = useState<string | null>(null);
  const [caseError, setCaseError] = useState<{ caseId: string; message: string } | null>(null);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, { first: string; last: string }>>({});
  const [permitPrompt, setPermitPrompt] = useState<CrematoryCaseSummary | null>(null);

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [sendAgain, setSendAgain] = useState(false);
  const [sending, setSending] = useState(false);
  /** `unclear`: the last send may have gone out — staff must check Sent
      Items and confirm it did not before trying again. A case sent
      successfully can never be sent again (the server refuses). */
  const [sendError, setSendError] = useState<{ message: string; unclear: boolean } | null>(null);
  const [result, setResult] = useState<CrematorySendResult | null>(null);
  const submissionId = useRef<string>('');

  const candidates = useMemo(() => overview.data?.candidates ?? [], [overview.data]);
  const chosen = candidates.filter((c) => selected.includes(c.caseId) && c.readiness.readyToSend);
  const attachments = useMemo(
    () =>
      assignAttachmentFileNames(chosen.map((c) => ({ fileName: c.expectedFileName ?? c.package!.fileName, caseNumber: c.caseNumber, summary: c }))).map((a) => ({
        attachmentName: a.attachmentName,
        decedentDisplayName: a.summary.subjectName,
        expectedReadyDate: a.summary.readyDate.confirmed!,
        version: a.summary.package!.version,
        caseNumber: a.caseNumber,
      })),
    [chosen],
  );

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['crematory', organizationId] });
  }

  // Opening the window prepares what it can from the cases' own documents
  // (2026-10): page 3 extracted, packages built or rebuilt. Once per case
  // per opening; nothing is ever sent.
  const preparedOnce = useRef<Set<string>>(new Set());
  const [preparing, setPreparing] = useState(false);
  useEffect(() => {
    if (!open) preparedOnce.current = new Set();
  }, [open]);
  useEffect(() => {
    if (!open || !overview.data?.canPrepare) return;
    const due = overview.data.candidates.filter((c) => !preparedOnce.current.has(c.caseId) && needsPreparation(c));
    if (due.length === 0) return;
    for (const c of due) preparedOnce.current.add(c.caseId);
    setPreparing(true);
    void (async () => {
      for (const c of due) {
        // A case that still needs something keeps showing what — not an error.
        await crematoryCaseAction(organizationId, c.caseId, { action: 'prepare' }).catch(() => undefined);
      }
      await Promise.all([refresh(), ...due.map((c) => queryClient.invalidateQueries({ queryKey: caseDocumentsKey(organizationId, c.caseId) }))]);
      setPreparing(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the overview changes
  }, [open, overview.data]);

  async function act(summary: CrematoryCaseSummary, run: () => Promise<unknown>) {
    setCaseError(null);
    setBusyCase(summary.caseId);
    try {
      await run();
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: caseDocumentsKey(organizationId, summary.caseId) })]);
    } catch (error) {
      setCaseError({ caseId: summary.caseId, message: error instanceof Error ? error.message : 'That did not work. Please try again.' });
    } finally {
      setBusyCase(null);
    }
  }

  function startReview() {
    const name = overview.data!.organizationName;
    setTo(overview.data!.settings.to.join(', '));
    setCc(overview.data!.settings.cc.join(', '));
    setSubject(crematoryEmailSubject(name, chosen.map((c) => ({ decedentDisplayName: c.subjectName, expectedReadyDate: c.readyDate.confirmed! }))));
    setMessage(defaultCrematoryMessage(name, attachments));
    setReviewed(false);
    setSendAgain(false);
    setSendError(null);
    submissionId.current = crypto.randomUUID();
    setStep('review');
  }

  async function send() {
    setSending(true);
    setSendError(null);
    try {
      const sent = await sendToCrematory({
        organizationId,
        caseIds: chosen.map((c) => c.caseId),
        to: parseRecipientList(to),
        cc: parseRecipientList(cc),
        subject,
        message,
        submissionId: submissionId.current,
        confirmResend: sendAgain,
      });
      setResult(sent);
      setStep('done');
      await refresh();
    } catch (error) {
      const unclear = error instanceof CrematoryRequestError && error.status === 409 && /may have been sent/i.test(error.message);
      setSendError({ message: error instanceof Error ? error.message : 'The email could not be sent.', unclear });
      submissionId.current = crypto.randomUUID();
      await refresh();
    } finally {
      setSending(false);
    }
  }

  const mailbox = overview.data?.mailbox;
  const title = 'Send to Crematory';
  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className="sx-modal-header">
        <h2 className="sx-modal-title">{title}</h2>
        <button type="button" className="sx-icon-btn" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className={`sx-modal-body ${styles.body}`}>
        {overview.isPending && <p className={styles.muted}>Loading cases…</p>}
        {overview.error && (
          <div className="sx-form-banner sx-form-banner-error" role="alert">
            {overview.error.message}
          </div>
        )}

        {overview.data && step !== 'done' && (
          <p className={styles.mailbox}>
            {mailbox?.connected ? (
              mailbox.status === 'connected' ? (
                <>
                  From <strong>{mailbox.accountEmail}</strong> (Outlook)
                </>
              ) : (
                <span className={styles.warn}>The Outlook mailbox {mailbox.accountEmail} needs to be signed in again — Settings → Crematory.</span>
              )
            ) : (
              <span className={styles.warn}>No Outlook mailbox is connected. An administrator can connect one in Settings → Crematory.</span>
            )}
          </p>
        )}

        {overview.data && step === 'prepare' && (
          <>
            {preparing && (
              <p className={styles.muted} role="status">
                Preparing documents from each case&rsquo;s Arrangement Form and permit…
              </p>
            )}
            {!overview.data.canSend && (
              <div className="sx-form-banner sx-form-banner-info" role="status">
                {overview.data.canPrepare
                  ? 'You can prepare Crematory Packages, but sending them needs the Send Crematory Packages permission. Ask an administrator.'
                  : 'You can see what each case needs, but preparing and sending are limited to staff with those permissions.'}
              </div>
            )}
            {candidates.length === 0 && <p className={styles.muted}>No open cremation cases.</p>}
            <ul className={styles.cases}>
              {candidates.map((c) => (
                <CaseRow
                  key={c.caseId}
                  summary={c}
                  checked={selected.includes(c.caseId)}
                  onToggle={(on) => setSelected((current) => (on ? [...current, c.caseId] : current.filter((id) => id !== c.caseId)))}
                  busy={busyCase === c.caseId}
                  error={caseError?.caseId === c.caseId ? caseError.message : null}
                  dateValue={dates[c.caseId] ?? toIsoInput(c.readyDate.confirmed ?? c.readyDate.suggested)}
                  onDateChange={(value) => setDates((d) => ({ ...d, [c.caseId]: value }))}
                  nameValue={names[c.caseId] ?? c.packageName.confirmed ?? c.packageName.suggested ?? { first: '', last: '' }}
                  onNameChange={(value) => setNames((n) => ({ ...n, [c.caseId]: value }))}
                  onConfirmName={(value) => act(c, () => crematoryCaseAction(organizationId, c.caseId, { action: 'confirm_package_name', ...value }))}
                  canPrepare={overview.data!.canPrepare}
                  organizationId={organizationId}
                  onUploadPermit={(file) => act(c, () => uploadCaseDocument({ organizationId, caseId: c.caseId, file, documentTypeKey: PERMIT_TYPE }))}
                  onConfirmPermit={() => setPermitPrompt(c)}
                  onExtract={() => act(c, () => extractArrangementPage({ organizationId, caseId: c.caseId, kind: 'crematory_form' }))}
                  onConfirmDate={(value) => act(c, () => crematoryCaseAction(organizationId, c.caseId, { action: 'confirm_ready_date', date: value }))}
                  onBuild={() => act(c, () => crematoryCaseAction(organizationId, c.caseId, { action: 'build_package' }))}
                />
              ))}
            </ul>
          </>
        )}

        {overview.data && step === 'review' && (
          <div className={styles.review}>
            <label className="sx-label" htmlFor="crematory-to">
              To
            </label>
            <input id="crematory-to" className="sx-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="crematory@example.com" />
            <label className="sx-label" htmlFor="crematory-cc">
              CC
            </label>
            <input id="crematory-cc" className="sx-input" value={cc} onChange={(e) => setCc(e.target.value)} />
            <label className="sx-label" htmlFor="crematory-subject">
              Subject
            </label>
            <input id="crematory-subject" className="sx-input" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <label className="sx-label" htmlFor="crematory-message">
              Message
            </label>
            <textarea id="crematory-message" className={`sx-textarea ${styles.message}`} value={message} onChange={(e) => setMessage(e.target.value)} rows={8} />
            <p className="sx-label">Attachments — one PDF per decedent</p>
            <ul className={styles.attachments}>
              {attachments.map((a) => (
                <li key={a.attachmentName}>
                  <strong>{a.attachmentName}</strong>
                  <span className={styles.muted}>
                    {a.decedentDisplayName} · {a.caseNumber} · expected {toCaseDate(a.expectedReadyDate)} · Crematory Package v{a.version ?? 1}
                  </span>
                </li>
              ))}
            </ul>
            <label className={styles.confirm}>
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I reviewed the recipients, subject, message and attachments.
            </label>
            {sendError && (
              <div className="sx-form-banner sx-form-banner-error" role="alert">
                {sendError.message}
              </div>
            )}
            {sendError?.unclear && (
              <label className={styles.confirm}>
                <input type="checkbox" checked={sendAgain} onChange={(e) => setSendAgain(e.target.checked)} /> I checked Sent Items — it was not sent
              </label>
            )}
          </div>
        )}

        {step === 'done' && result && (
          <div className={styles.review} role="status">
            <div className="sx-form-banner sx-form-banner-info">
              Submitted to Outlook from {result.mailbox} to {result.to.join(', ')}. This confirms Outlook accepted the email — not that the crematory received it.
            </div>
            <ul className={styles.attachments}>
              {result.attachments.map((a) => (
                <li key={a.attachmentName}>
                  <strong>{a.attachmentName}</strong>
                  <span className={styles.muted}>
                    {a.decedentDisplayName} · {a.caseNumber} · v{a.packageVersion ?? 1}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="sx-modal-footer">
        {step === 'review' && (
          <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setStep('prepare')} disabled={sending}>
            Back
          </button>
        )}
        <button type="button" className="sx-btn sx-btn-ghost" onClick={onClose}>
          {step === 'done' ? 'Done' : 'Close'}
        </button>
        {step === 'prepare' && (
          <button type="button" className="sx-btn sx-btn-primary" onClick={startReview} disabled={chosen.length === 0 || !overview.data?.canSend}>
            Review email{chosen.length > 0 ? ` (${chosen.length})` : ''}
          </button>
        )}
        {step === 'review' && (
          <button
            type="button"
            className="sx-btn sx-btn-primary"
            onClick={send}
            disabled={sending || !reviewed || parseRecipientList(to).length === 0 || !subject.trim() || (sendError?.unclear === true && !sendAgain)}
          >
            {sending ? 'Sending…' : `Send to Crematory (${chosen.length})`}
          </button>
        )}
      </div>

      {permitPrompt && permitPrompt.permit && (
        <Modal open onClose={() => setPermitPrompt(null)} title="Confirm the state permit">
          <div className="sx-modal-header">
            <h2 className="sx-modal-title">Confirm the state permit</h2>
          </div>
          <div className="sx-modal-body">
            <p>
              Is <strong>{permitPrompt.permit.fileName}</strong>
              {permitPrompt.permit.uploadedBy ? ` (uploaded by ${permitPrompt.permit.uploadedBy}, ${formatTimestamp(permitPrompt.permit.createdAt)})` : ''} the <strong>approved</strong> state cremation permit for{' '}
              <strong>{permitPrompt.decedentDisplayName}</strong> ({permitPrompt.caseNumber})?
            </p>
            <p>
              <a href={buildCaseDocumentDownloadUrl(organizationId, permitPrompt.caseId, permitPrompt.permit.documentId)} target="_blank" rel="noreferrer">
                Open the permit to check it
              </a>
            </p>
          </div>
          <div className="sx-modal-footer">
            <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setPermitPrompt(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="sx-btn sx-btn-primary"
              onClick={() => {
                const target = permitPrompt;
                setPermitPrompt(null);
                void act(target, () => crematoryCaseAction(organizationId, target.caseId, { action: 'confirm_permit', documentId: target.permit!.documentId }));
              }}
            >
              Yes, this is the approved permit
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function toIsoInput(caseDate: string | null): string {
  const d = toCaseDate(caseDate);
  return d ? `${d.slice(6, 10)}-${d.slice(0, 2)}-${d.slice(3, 5)}` : '';
}

type StepKey = 'permit_uploaded' | 'permit_verified' | 'crematory_form' | 'workflow_2' | 'package_name' | 'ready_date' | 'package';
const STEPS: Array<{ key: StepKey; label: string }> = [
  { key: 'permit_uploaded', label: 'State permit' },
  { key: 'permit_verified', label: 'Permit confirmed' },
  { key: 'crematory_form', label: 'Arrangement page 3' },
  { key: 'workflow_2', label: 'Workflow 2' },
  { key: 'package_name', label: 'Name for the file' },
  { key: 'ready_date', label: 'Expected ready date' },
  { key: 'package', label: 'Crematory Package' },
];

/**
 * One case as a compact checklist (2026-10): a fixed list of steps, each
 * with ✓ (done), ● (needs you now) or ○ (waiting on an earlier step), a
 * short label, and on the same line either what was recorded or the one
 * action that completes it. A case already sent collapses to one line.
 */
function CaseRow({
  summary,
  checked,
  onToggle,
  busy,
  error,
  dateValue,
  onDateChange,
  organizationId,
  onUploadPermit,
  onConfirmPermit,
  onExtract,
  onConfirmDate,
  onBuild,
  nameValue,
  onNameChange,
  onConfirmName,
  canPrepare,
}: {
  summary: CrematoryCaseSummary;
  checked: boolean;
  onToggle: (on: boolean) => void;
  busy: boolean;
  error: string | null;
  dateValue: string;
  onDateChange: (value: string) => void;
  organizationId: string;
  onUploadPermit: (file: File) => void;
  onConfirmPermit: () => void;
  onExtract: () => void;
  onConfirmDate: (value: string) => void;
  onBuild: () => void;
  nameValue: { first: string; last: string };
  onNameChange: (value: { first: string; last: string }) => void;
  onConfirmName: (value: { first: string; last: string }) => void;
  canPrepare: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const req = (key: string) => summary.readiness.requirements.find((r) => r.key === key);
  const ok = (key: StepKey) => req(key)?.ok === true;
  const ready = summary.readiness.readyToSend;
  const last = summary.lastSubmission;
  const sent = last?.status === 'submitted';
  const notCremation = req('cremation')?.ok === false;
  const done = STEPS.filter((step) => ok(step.key)).length;

  // A step waits (○) while an earlier step it depends on is unfinished.
  const waiting: Record<StepKey, boolean> = {
    permit_uploaded: false,
    permit_verified: !ok('permit_uploaded'),
    crematory_form: !ok('permit_verified'),
    workflow_2: false,
    package_name: false,
    ready_date: false,
    package: !summary.readiness.readyToBuild,
  };

  const status = sent ? (
    <span className="sx-status sx-status-ok">Sent</span>
  ) : ready ? (
    <span className="sx-status sx-status-ok">Ready</span>
  ) : (
    <span className="sx-status sx-status-warn">{done} of {STEPS.length} done</span>
  );

  function content(key: StepKey) {
    const r = req(key);
    if (ok(key)) {
      switch (key) {
        case 'permit_uploaded':
          return <span className={styles.value}>{summary.permit?.fileName}</span>;
        case 'package_name':
          return summary.packageName.confirmed && <span className={styles.value}>{summary.packageName.confirmed.last}, {summary.packageName.confirmed.first}</span>;
        case 'ready_date':
          return <span className={styles.value}>{summary.readyDate.confirmed}</span>;
        case 'package':
          return (
            summary.package && (
              <span className={styles.value}>
                <a href={buildCaseDocumentDownloadUrl(organizationId, summary.caseId, summary.package.documentId)}>{summary.package.fileName}</a> · v{summary.package.version ?? 1}
              </span>
            )
          );
        default:
          return null;
      }
    }
    // The Arrangement Form not having arrived is the real blocker — say so.
    if (key === 'crematory_form' && /not been received/i.test(r?.detail ?? '')) return <span className={styles.hint}>Waiting for the Arrangement Form</span>;
    if (waiting[key]) return <span className={styles.hint}>{key === 'package' ? 'After the steps above' : 'After the step above'}</span>;
    if (!canPrepare) return <span className={styles.hint}>{r?.detail}</span>;
    switch (key) {
      case 'permit_uploaded':
        return (
          <>
            <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" disabled={busy} onClick={() => fileInput.current?.click()}>
              Upload PDF
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUploadPermit(file);
                e.target.value = '';
              }}
            />
          </>
        );
      case 'permit_verified':
        return (
          <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" disabled={busy} onClick={onConfirmPermit}>
            Confirm permit
          </button>
        );
      case 'crematory_form':
        return /not been received/i.test(r?.detail ?? '') ? (
          <span className={styles.hint}>Waiting for the Arrangement Form</span>
        ) : (
          <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" disabled={busy} onClick={onExtract}>
            Extract page 3
          </button>
        );
      case 'workflow_2':
        return (
          <span className={styles.hint}>
            Finish it on the <Link href={`/cases/${summary.caseId}`}>case</Link>
          </span>
        );
      case 'package_name':
        return (
          <span className={styles.inputs}>
            <input className="sx-input" aria-label={`Last name for ${summary.decedentDisplayName}`} placeholder="Last name(s)" value={nameValue.last} onChange={(e) => onNameChange({ ...nameValue, last: e.target.value })} />
            <input className="sx-input" aria-label={`First name(s) for ${summary.decedentDisplayName}`} placeholder="First name(s)" value={nameValue.first} onChange={(e) => onNameChange({ ...nameValue, first: e.target.value })} />
            <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" disabled={busy || !nameValue.first.trim() || !nameValue.last.trim()} onClick={() => onConfirmName(nameValue)}>
              Confirm name
            </button>
            {summary.packageName.suggestedFrom && summary.packageName.suggested?.first === nameValue.first && summary.packageName.suggested?.last === nameValue.last && (
              <span className={styles.hint}>
                Filled in from {summary.packageName.suggestedFrom === 'form' ? "the family's form" : 'the case name'} — check, then confirm.
              </span>
            )}
            {nameValue.first.trim() && nameValue.last.trim() && (
              <span className={styles.hint}>File: {crematoryPackageFileName(nameValue, summary.readyDate.confirmed ?? summary.readyDate.suggested) ?? `${nameValue.last.trim().toUpperCase()}_${nameValue.first.trim().toUpperCase()}_CREMATORY_PACKAGE_MM-DD-YYYY.pdf`}</span>
            )}
          </span>
        );
      case 'ready_date':
        return (
          <span className={styles.inputs}>
            <input type="date" className="sx-input" aria-label={`Expected ready date for ${summary.decedentDisplayName}`} value={dateValue} onChange={(e) => onDateChange(e.target.value)} />
            <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" disabled={busy || !dateValue} onClick={() => onConfirmDate(dateValue)}>
              Confirm date
            </button>
            {/Expected Pickup changed/.test(r?.detail ?? '') && <span className={styles.hint}>The Expected Pickup moved — review</span>}
          </span>
        );
      case 'package':
        return (
          <button type="button" className="sx-btn sx-btn-primary sx-btn-sm" disabled={busy} onClick={onBuild}>
            {summary.package ? 'Rebuild package' : 'Build package'}
          </button>
        );
    }
  }

  return (
    <li className={`${styles.case} ${sent ? styles.caseSent : ''}`}>
      <div className={styles.caseHead}>
        <label className={styles.caseTitle}>
          <input type="checkbox" checked={checked && ready} disabled={!ready || busy} onChange={(e) => onToggle(e.target.checked)} aria-label={`Select ${summary.decedentDisplayName}`} />
          <span>
            <strong>{summary.decedentDisplayName}</strong> · <Link href={`/cases/${summary.caseId}`}>{summary.caseNumber}</Link>
          </span>
        </label>
        {status}
      </div>

      {sent && last ? (
        <p className={styles.hint}>
          Sent {formatTimestamp(last.at)} to {last.to.join(', ')} · {last.attachmentName}
        </p>
      ) : ready && summary.package ? (
        // Everything is done: one line, not seven checkmarks.
        <p className={styles.hint}>
          <a href={buildCaseDocumentDownloadUrl(organizationId, summary.caseId, summary.package.documentId)}>{summary.package.fileName}</a> · v{summary.package.version ?? 1} · expected{' '}
          {summary.readyDate.confirmed}
        </p>
      ) : notCremation ? (
        <p className={styles.hint}>{req('cremation')?.detail}</p>
      ) : (
        <ol className={styles.steps}>
          {STEPS.map((step) => {
            const state = ok(step.key) ? 'done' : waiting[step.key] ? 'waiting' : 'todo';
            return (
              <li key={step.key} className={styles.step} data-state={state}>
                <span className={styles.mark} aria-label={state === 'done' ? 'Done' : state === 'waiting' ? 'Waiting' : 'To do'}>
                  {state === 'done' ? '✓' : state === 'waiting' ? '○' : '●'}
                </span>
                <span className={styles.stepLabel}>{step.label}</span>
                <span className={styles.stepContent}>{content(step.key)}</span>
              </li>
            );
          })}
        </ol>
      )}

      {last && !sent && (
        <p className={styles.warn}>
          {last.status === 'uncertain'
            ? `The last send may not have completed (${formatTimestamp(last.at)}) — check Sent Items in ${last.mailbox ?? 'the mailbox'}.`
            : `The last send failed (${formatTimestamp(last.at)}): ${last.error ?? 'unknown error'}`}
        </p>
      )}
      {busy && <p className={styles.hint}>Working…</p>}
      {error && (
        <div className="sx-form-banner sx-form-banner-error" role="alert">
          {error}
        </div>
      )}
    </li>
  );
}
