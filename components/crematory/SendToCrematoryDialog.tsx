'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import {
  crematoryCaseAction,
  CrematoryRequestError,
  fetchCrematoryOverview,
  reviewCrematorySend,
  sendToCrematory,
  type CrematoryCaseSummary,
  type CrematorySendResult,
} from '@/lib/crematoryClient';
import { buildCaseDocumentDownloadUrl, buildCaseDocumentViewUrl, uploadCaseDocument } from '@/lib/caseDocumentsClient';
import {
  assignAttachmentFileNames,
  crematoryEmailSubject,
  crematoryPackageFileName,
  defaultCrematoryMessage,
  toCaseDate,
  type CrematorySourceKind,
} from '@/domain/crematory/crematoryPackage';
import { parseRecipientList } from '@/domain/crematory/crematorySettings';
import { formatTimestamp } from '@/utils/format';
import { caseDocumentsKey } from '@/hooks/useCaseDocumentLibrary';
import { ReplacePermitButton } from './ReplacePermitButton';
import { PreviousSendDialog } from './PreviousSendDialog';
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
  onResolveWorkflow,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  /** The case page's own case — only it is shown, already selected. */
  caseId?: string;
  /** Cases already ticked on the Cases page — selected if they are ready. */
  preselectedCaseIds?: string[];
  /** Resolve Workflow 2 (2026-10) on the case page itself: it closes this
      window and opens the stage. Elsewhere the case page is opened on it. */
  onResolveWorkflow?: (caseId: string, displayStage: number) => void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const queryKey = ['crematory', organizationId, caseId ?? 'all'];
  const [previousSendFor, setPreviousSendFor] = useState<CrematoryCaseSummary | null>(null);

  /** Closes this window and opens the case on its Workflow 2 step; nothing on the case changes. */
  function resolveWorkflow(c: CrematoryCaseSummary) {
    const stage = c.workflow2?.displayStage ?? 2;
    if (onResolveWorkflow) {
      onResolveWorkflow(c.caseId, stage);
      return;
    }
    onClose();
    router.push(`/cases/${encodeURIComponent(c.caseId)}?workflowStage=${stage}`);
  }
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
  /** What the server will check the send against (2026-10). */
  const reviewFingerprint = useRef<string>('');
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

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
  /** Cases being prepared right now — their checklist is not final until done. */
  const [preparingIds, setPreparingIds] = useState<string[]>([]);
  const [prepareErrors, setPrepareErrors] = useState<Record<string, string>>({});
  const [chooser, setChooser] = useState<{ summary: CrematoryCaseSummary; kind: CrematorySourceKind; documentId?: string } | null>(null);
  useEffect(() => {
    if (!open) preparedOnce.current = new Set();
  }, [open]);

  /** Prepares one case's page 3 and package; refreshes its checklist when done. */
  async function prepareCase(caseId: string) {
    setPreparingIds((ids) => [...ids, caseId]);
    setPrepareErrors((errors) => {
      const next = { ...errors };
      delete next[caseId];
      return next;
    });
    try {
      const { result } = (await crematoryCaseAction(organizationId, caseId, { action: 'prepare' })) as { result?: { crematoryForm: string; package: string } };
      if (result && (result.crematoryForm === 'failed' || result.package === 'failed')) {
        setPrepareErrors((e) => ({ ...e, [caseId]: `SOLIS could not prepare ${result.crematoryForm === 'failed' ? "page 3 of this case's Arrangement Form" : 'the Crematory Package'}. Nothing was sent. Try again.` }));
      }
    } catch (error) {
      setPrepareErrors((e) => ({ ...e, [caseId]: `${error instanceof Error ? error.message : "This case's documents could not be prepared."} Nothing was sent. Try again.` }));
    } finally {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: caseDocumentsKey(organizationId, caseId) })]);
      setPreparingIds((ids) => ids.filter((id) => id !== caseId));
    }
  }

  useEffect(() => {
    if (!open || !overview.data?.canPrepare) return;
    const due = overview.data.candidates.filter((c) => !preparedOnce.current.has(c.caseId) && needsPreparation(c));
    if (due.length === 0) return;
    for (const c of due) preparedOnce.current.add(c.caseId);
    // Every due case shows "Preparing…" at once; each is prepared in turn.
    setPreparingIds((ids) => [...ids, ...due.map((c) => c.caseId)]);
    void (async () => {
      for (const c of due) {
        setPreparingIds((ids) => ids.filter((id) => id !== c.caseId));
        await prepareCase(c.caseId);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the overview changes
  }, [open, overview.data]);
  const preparing = preparingIds.length > 0;

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

  async function startReview() {
    setReviewError(null);
    setReviewing(true);
    try {
      reviewFingerprint.current = (await reviewCrematorySend(organizationId, chosen.map((c) => c.caseId))).fingerprint;
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Could not prepare the email for review.');
      await refresh();
      return;
    } finally {
      setReviewing(false);
    }
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
        reviewFingerprint: reviewFingerprint.current,
        acknowledged: reviewed,
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
                Preparing documents from each case&rsquo;s Arrangement Form and permit… The checklists update as each case finishes.
              </p>
            )}
            {chooser && (
              <ChooseDocumentDialog
                organizationId={organizationId}
                summary={chooser.summary}
                kind={chooser.kind}
                initialDocumentId={chooser.documentId}
                onClose={() => setChooser(null)}
                onChoose={(documentId) => {
                  const { summary, kind } = chooser;
                  setChooser(null);
                  void act(summary, () => crematoryCaseAction(organizationId, summary.caseId, { action: 'assign_document', documentId, as: kind }));
                }}
              />
            )}
            {!overview.data.canSend && (
              <div className="sx-form-banner sx-form-banner-info" role="status">
                {overview.data.canPrepare
                  ? 'You can prepare Crematory Packages, but sending them needs the Send Crematory Packages permission. Ask an administrator.'
                  : 'You can see what each case needs, but preparing and sending are limited to staff with those permissions.'}
              </div>
            )}
            {reviewError && (
              <div className="sx-form-banner sx-form-banner-error" role="alert">
                {reviewError}
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
                  onExtract={() => void prepareCase(c.caseId)}
                  preparing={preparingIds.includes(c.caseId)}
                  prepareError={prepareErrors[c.caseId] ?? null}
                  onRetryPrepare={() => void prepareCase(c.caseId)}
                  onChooseDocument={(kind, documentId) => setChooser({ summary: c, kind, documentId })}
                  onPermitReplaced={() => void Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: caseDocumentsKey(organizationId, c.caseId) })])}
                  canSend={overview.data!.canSend}
                  onResolveWorkflow={() => resolveWorkflow(c)}
                  onVerifyPreviousSend={() => setPreviousSendFor(c)}
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
          <button type="button" className="sx-btn sx-btn-primary" onClick={() => void startReview()} disabled={chosen.length === 0 || !overview.data?.canSend || reviewing}>
            {reviewing ? 'Preparing review…' : `Review email${chosen.length > 0 ? ` (${chosen.length})` : ''}`}
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

      {previousSendFor && (
        <PreviousSendDialog
          organizationId={organizationId}
          summary={previousSendFor}
          onClose={() => setPreviousSendFor(null)}
          onRecorded={() => {
            setPreviousSendFor(null);
            void refresh();
          }}
        />
      )}

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
  preparing,
  prepareError,
  onRetryPrepare,
  onChooseDocument,
  onPermitReplaced,
  canSend,
  onResolveWorkflow,
  onVerifyPreviousSend,
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
  /** Automatic preparation is running for this case: the checklist is not final yet. */
  preparing: boolean;
  prepareError: string | null;
  onRetryPrepare: () => void;
  /** Opens the chooser — with `documentId` already picked for an inline suggestion. */
  onChooseDocument: (kind: CrematorySourceKind, documentId?: string) => void;
  onPermitReplaced: () => void;
  canSend: boolean;
  onResolveWorkflow: () => void;
  onVerifyPreviousSend: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const req = (key: string) => summary.readiness.requirements.find((r) => r.key === key);
  const ok = (key: StepKey) => req(key)?.ok === true;
  const ready = summary.readiness.readyToSend;
  const last = summary.lastSubmission;
  const sent = last?.status === 'submitted';
  const notCremation = req('cremation')?.ok === false;
  const done = STEPS.filter((step) => ok(step.key)).length;
  // Replace Permit (2026-10): staff who prepare, before the case is sent
  // (never once sent or while a send's outcome is unclear).
  const replacePermit =
    canPrepare && summary.permit && (!last || last.status === 'failed') ? (
      <ReplacePermitButton organizationId={organizationId} caseId={summary.caseId} decedentDisplayName={summary.decedentDisplayName} permit={summary.permit} disabled={busy || preparing} onReplaced={onPermitReplaced} />
    ) : null;

  // A step waits (○) while an earlier step it depends on is unfinished.
  const waiting: Record<StepKey, boolean> = {
    permit_uploaded: false,
    permit_verified: !ok('permit_uploaded'),
    // Page 3 is prepared from the Arrangement Form alone (2026-10) — never waits on the permit.
    crematory_form: false,
    workflow_2: false,
    package_name: false,
    ready_date: false,
    package: !summary.readiness.readyToBuild,
  };

  const previousSend = req('previous_send');
  const status = sent ? (
    <span className="sx-status sx-status-ok">Sent</span>
  ) : summary.previousSend?.recorded?.decision === 'sent_outside_solis' ? (
    <span className="sx-status sx-status-warn">Sent outside SOLIS</span>
  ) : preparing ? (
    <span className="sx-status" role="status">
      Preparing…
    </span>
  ) : ready ? (
    <span className="sx-status sx-status-ok">Ready</span>
  ) : previousSend && !previousSend.ok ? (
    <span className="sx-status sx-status-warn">Verify previous send</span>
  ) : (
    <span className="sx-status sx-status-warn">{done} of {STEPS.length} done</span>
  );

  function content(key: StepKey) {
    const r = req(key);
    if (ok(key)) {
      switch (key) {
        case 'permit_uploaded':
          return (
            <>
              <span className={styles.value}>{summary.permit?.fileName}</span>
              {replacePermit}
            </>
          );
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
    // Not final while SOLIS is preparing this case (2026-10).
    if (preparing && (key === 'crematory_form' || key === 'package')) return <span className={styles.hint}>Preparing…</span>;
    // Resolve Workflow 2 (2026-10): the exact steps still unchecked — the
    // ME verification steps on an ME case — and the way to them. Staff
    // check them on the case themselves; nothing is checked from here.
    if (key === 'workflow_2' && summary.workflow2) {
      return (
        <span className={styles.inputs}>
          {summary.workflow2.missing.length > 0 && (
            <span className={styles.hint}>
              {summary.workflow2.medicalExaminer ? 'Medical Examiner case — to check: ' : 'To check: '}
              {summary.workflow2.missing.join(' · ')}
            </span>
          )}
          <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" onClick={onResolveWorkflow}>
            Resolve Workflow 2
          </button>
        </span>
      );
    }
    const chooseFromCase = (kind: CrematorySourceKind) =>
      canPrepare && summary.untypedDocuments.length > 0 ? (
        <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" disabled={busy} onClick={() => onChooseDocument(kind)}>
          Choose from this case&rsquo;s documents
        </button>
      ) : null;
    // An untyped PDF on the case whose name suggests it (2026-10): shown
    // first, to open and check. "Use as …" opens the chooser with it
    // picked — staff still choose it there; a name never classifies it.
    const suggestions = (kind: CrematorySourceKind) =>
      canPrepare
        ? summary.untypedDocuments
            .filter((d) => d.suggestedAs === kind)
            .map((d) => (
              <span key={d.documentId} className={styles.hint}>
                <strong>{d.fileName}</strong> may be the {kind === 'state_permit' ? 'permit' : 'Arrangement Form'} ·{' '}
                <a href={buildCaseDocumentViewUrl(organizationId, summary.caseId, d.documentId)} target="_blank" rel="noreferrer">
                  Open
                </a>{' '}
                ·{' '}
                <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" disabled={busy} onClick={() => onChooseDocument(kind, d.documentId)}>
                  {kind === 'state_permit' ? 'Use as permit' : 'Use as Arrangement Form'}
                </button>
              </span>
            ))
        : null;
    // The Arrangement Form not having arrived is the real blocker — say so.
    if (key === 'crematory_form' && /not been received/i.test(r?.detail ?? '')) {
      return (
        <>
          {suggestions('arrangement_forms')}
          <span className={styles.hint}>Waiting for the Arrangement Form</span>
          {chooseFromCase('arrangement_forms')}
        </>
      );
    }
    if (waiting[key]) return <span className={styles.hint}>{key === 'package' ? 'After the steps above' : 'After the step above'}</span>;
    if (!canPrepare) return <span className={styles.hint}>{r?.detail}</span>;
    switch (key) {
      case 'permit_uploaded':
        return (
          <>
            {suggestions('state_permit')}
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
            {chooseFromCase('state_permit')}
          </>
        );
      case 'permit_verified':
        return (
          <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" disabled={busy} onClick={onConfirmPermit}>
            Confirm permit
          </button>
        );
      case 'crematory_form':
        return (
          <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" disabled={busy} onClick={onExtract}>
            Extract page 3
          </button>
        );
      case 'workflow_2':
        return <span className={styles.hint}>{r?.detail}</span>;
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

      {!sent && previousSend && !previousSend.ok && (
        <div className={`sx-form-banner ${summary.previousSend?.recorded ? 'sx-form-banner-info' : 'sx-form-banner-error'}`} role={summary.previousSend?.recorded ? 'status' : 'alert'}>
          {previousSend.detail}{' '}
          {!summary.previousSend?.recorded &&
            (canSend ? (
              <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" disabled={busy} onClick={onVerifyPreviousSend}>
                Verify previous send
              </button>
            ) : (
              <span className={styles.hint}>Staff with the Send Crematory Packages permission must verify it.</span>
            ))}
        </div>
      )}

      {sent && last ? (
        <p className={styles.hint}>
          Sent {formatTimestamp(last.at)} to {last.to.join(', ')} · {last.attachmentName}
        </p>
      ) : ready && summary.package ? (
        // Everything is done: one line, not seven checkmarks.
        <p className={styles.hint}>
          <a href={buildCaseDocumentDownloadUrl(organizationId, summary.caseId, summary.package.documentId)}>{summary.package.fileName}</a> · v{summary.package.version ?? 1} · expected{' '}
          {summary.readyDate.confirmed} {replacePermit}
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
      {prepareError && !preparing && (
        <div className="sx-form-banner sx-form-banner-error" role="alert">
          {prepareError}{' '}
          {canPrepare && (
            <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" onClick={onRetryPrepare}>
              Try again
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="sx-form-banner sx-form-banner-error" role="alert">
          {error}
        </div>
      )}
    </li>
  );
}

const SOURCE_LABEL: Record<CrematorySourceKind, { name: string; hint: string }> = {
  state_permit: { name: 'State Cremation Permit', hint: 'its name mentions a permit' },
  arrangement_forms: { name: 'Arrangement Form', hint: 'its name mentions the Arrangement Form' },
};

/**
 * "Choose from this case's documents" (2026-10): the case's own active,
 * untyped PDFs, likely matches first — each can be opened to check — and
 * nothing chosen until staff pick one and confirm. Only that document's
 * type is set; the file is not changed or copied.
 */
function ChooseDocumentDialog({
  organizationId,
  summary,
  kind,
  initialDocumentId,
  onClose,
  onChoose,
}: {
  organizationId: string;
  summary: CrematoryCaseSummary;
  kind: CrematorySourceKind;
  initialDocumentId?: string;
  onClose: () => void;
  onChoose: (documentId: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(initialDocumentId ?? null);
  const label = SOURCE_LABEL[kind];
  const documents = [...summary.untypedDocuments].sort((a, b) => Number(b.suggestedAs === kind) - Number(a.suggestedAs === kind));
  return (
    <Modal open onClose={onClose} title={`Choose the ${label.name}`}>
      <div className="sx-modal-header">
        <h2 className="sx-modal-title">Choose the {label.name}</h2>
        <button type="button" className="sx-icon-btn" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="sx-modal-body">
        <p className={styles.hint}>
          PDFs already uploaded to {summary.decedentDisplayName}&rsquo;s case ({summary.caseNumber}) without a document type. Open one to check it, then choose it.
          Only its document type is set — the file is not changed or copied.
        </p>
        <ul className={styles.cases}>
          {documents.map((d) => (
            <li key={d.documentId}>
              <label>
                <input type="radio" name="crematory-source-document" checked={picked === d.documentId} onChange={() => setPicked(d.documentId)} /> {d.fileName}
              </label>{' '}
              <span className={styles.hint}>
                uploaded {formatTimestamp(d.createdAt)}
                {d.suggestedAs === kind ? ` · Suggested — ${label.hint}` : ''}
              </span>{' '}
              <a href={buildCaseDocumentViewUrl(organizationId, summary.caseId, d.documentId)} target="_blank" rel="noreferrer">
                Open
              </a>
            </li>
          ))}
        </ul>
        {kind === 'state_permit' && <p className={styles.hint}>Next you&rsquo;ll confirm the permit is this decedent&rsquo;s.</p>}
      </div>
      <div className="sx-modal-footer">
        <button type="button" className="sx-btn sx-btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="sx-btn sx-btn-primary" disabled={!picked} onClick={() => picked && onChoose(picked)}>
          Use as the {label.name}
        </button>
      </div>
    </Modal>
  );
}
