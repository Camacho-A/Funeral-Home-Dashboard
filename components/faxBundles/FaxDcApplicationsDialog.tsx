'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { PdfViewer } from '@/components/documents/PdfViewer';
import {
  FaxRequestError,
  faxBundlePdfUrl,
  fetchFaxEligibility,
  newSubmissionId,
  previewFaxBundle,
  sendFaxBundle,
  type FaxBundleView,
  type FaxDestinationChoice,
  type FaxEligibleCase,
} from '@/lib/faxBundlesClient';
import styles from './FaxDcApplicationsDialog.module.css';

/**
 * Manatee County DC application fax bundles (2026-11).
 *
 *   1 Select cases → 2 Review fax → 3 Confirm & send.
 *
 * Staff tick exactly the applications they want; the order they tick is
 * the order in the bundle (and can be changed). Review builds the one PDF
 * on the server and shows that exact stored file; Confirm names where it
 * goes and what it is, and Send Fax — only there, only once the box is
 * ticked — transmits it. The server's duplicate-send protection and its
 * own checks stay the safeguard; this dialog only asks.
 *
 * Redesign (2026-11): three labelled steps in a wide, full-height dialog,
 * so the PDF gets most of the screen and one area scrolls at a time. The
 * requests and their behavior are unchanged.
 */

type Step = 'select' | 'review' | 'confirm' | 'sent';
const STEPS: ReadonlyArray<{ key: Exclude<Step, 'sent'>; label: string }> = [
  { key: 'select', label: 'Select cases' },
  { key: 'review', label: 'Review fax' },
  { key: 'confirm', label: 'Confirm & send' },
];

const shortDate = (localDate: string | null) => (localDate ? new Date(`${localDate}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : null);
const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sameOrder = (ids: readonly string[], bundle: FaxBundleView | null) => bundle !== null && ids.length === bundle.items.length && bundle.items.every((item, i) => item.caseId === ids[i]);
/** 'builtin' is the organization's built-in destination, which a bundle records as null. */
const sameDestination = (choiceId: string | null, bundle: FaxBundleView) => (choiceId === 'builtin' ? null : choiceId) === (bundle.destinationId ?? null);

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
  const [step, setStep] = useState<Step>('select');
  const [picked, setPicked] = useState<string[] | null>(null);
  const [bundle, setBundle] = useState<FaxBundleView | null>(null);
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null);
  const [error, setError] = useState<{ message: string; mayHaveSent: boolean } | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  /** A bundle whose send may have gone out: never offered for sending again from this dialog, whichever step staff go back to. */
  const [uncertainBundleId, setUncertainBundleId] = useState<string | null>(null);
  const submissionId = useRef(newSubmissionId());
  const confirmId = useId();
  const destinationSelectId = useId();
  /** The destination staff chose for this fax; null until they change it (the default is used). */
  const [pickedDestinationId, setPickedDestinationId] = useState<string | null>(null);

  const cases = useMemo(() => eligibility.data?.cases ?? [], [eligibility.data]);
  const byId = useMemo(() => new Map(cases.map((c) => [c.caseId, c])), [cases]);
  const max = eligibility.data?.maxApplications ?? 20;
  const destinations: FaxDestinationChoice[] = useMemo(
    () => eligibility.data?.destinations ?? (eligibility.data ? [{ id: 'builtin', name: eligibility.data.destinationName, faxNumberDisplay: eligibility.data.destinationFax, isDefault: true }] : []),
    [eligibility.data],
  );
  const destination = destinations.find((d) => d.id === pickedDestinationId) ?? destinations.find((d) => d.isDefault) ?? destinations[0] ?? null;
  const availableCount = cases.filter((c) => c.available).length;
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
  const go = (next: Step) => {
    setStep(next);
    setError(null);
    setConfirmed(false);
  };

  async function review() {
    // Back from Review with nothing changed: the bundle already prepared is
    // still the one to check — no second bundle for the same selection.
    // A different destination is a different fax: always a new preview.
    if (sameOrder(selected, bundle) && sameDestination(destination?.id ?? null, bundle!) && bundle!.state === 'ready' && bundle!.id !== uncertainBundleId) return go('review');
    setBusy('preview');
    setError(null);
    setProblems({});
    try {
      const built = await previewFaxBundle(organizationId, selected, destination?.id ?? null);
      setBundle(built);
      submissionId.current = newSubmissionId();
      go('review');
    } catch (e) {
      if (e instanceof FaxRequestError && e.caseProblems.length > 0) setProblems(Object.fromEntries(e.caseProblems.map((p) => [p.caseId, p.reason])));
      setError({ message: e instanceof Error ? e.message : 'The bundle could not be prepared.', mayHaveSent: false });
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!bundle || !confirmed) return;
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
      else setUncertainBundleId(bundle.id);
      setError({ message, mayHaveSent: !nothingSent });
    } finally {
      setBusy(null);
    }
  }

  const title = 'Fax DC Applications';
  const data = eligibility.data;
  const sendingOff = (bundle ? !bundle.sendingEnabled : data ? !data.sendingEnabled : false) && step !== 'sent';
  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const uncertain = bundle !== null && bundle.id === uncertainBundleId;
  const canSend = bundle !== null && confirmed && busy === null && bundle.sendingEnabled && bundle.senderAddress !== null && bundle.state === 'ready' && !uncertain;
  const sections = bundle?.items.map((i) => ({ label: `Request ${i.position} of ${bundle.applicationCount} — ${i.decedentDisplayName} (${i.caseNumber})`, pageCount: i.pageCount }));

  return (
    <Modal open onClose={onClose} title={title} size="xl">
      <div className="sx-modal-header">
        <h2 className="sx-modal-title">{title}</h2>
        <button type="button" className="sx-icon-btn" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      {step !== 'sent' && (
        <ol className={styles.steps} aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.key} className={`${styles.stepItem} ${i === stepIndex ? styles.stepCurrent : ''} ${i < stepIndex ? styles.stepDone : ''}`} aria-current={i === stepIndex ? 'step' : undefined}>
              <span className={styles.stepNumber} aria-hidden="true">
                {i < stepIndex ? '✓' : i + 1}
              </span>
              <span className={styles.stepLabel}>
                <span className={styles.srOnly}>Step {i + 1} of 3: </span>
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className={`sx-modal-body ${styles.body} ${styles[`body_${step}`]}`}>
        <div className={styles.notices}>
          {eligibility.isPending && <p className={styles.muted}>Loading saved applications…</p>}
          {eligibility.error && (
            <div className={`sx-form-banner sx-form-banner-error ${styles.banner}`} role="alert">
              <span>
                <strong>The saved applications could not be loaded.</strong> {eligibility.error.message}{' '}
                <button type="button" className={styles.linkButton} onClick={() => void eligibility.refetch()}>
                  Try again
                </button>
              </span>
            </div>
          )}
          {sendingOff && (
            <div className={`sx-form-banner ${styles.banner} ${styles.bannerWarn}`} role="status">
              <span>
                <strong>Fax sending isn&rsquo;t turned on yet.</strong> You can select cases and review the fax; Send Fax becomes available once the NuSo setup is verified.
              </span>
            </div>
          )}
          {error && (
            <div className={`sx-form-banner sx-form-banner-error ${styles.banner}`} role="alert">
              <span>
                {error.mayHaveSent && <strong>Do not send this fax again. </strong>}
                {error.message}
                {error.mayHaveSent && ' Check the Outlook Sent folder and the case’s Documents tab before doing anything else.'}
              </span>
            </div>
          )}
          {uncertain && !error && step !== 'sent' && (
            <div className={`sx-form-banner ${styles.banner} ${styles.bannerWarn}`} role="status">
              <span>
                <strong>{bundle!.reference} may already have been sent.</strong> It can&rsquo;t be sent again from here — check the Outlook Sent folder and the case&rsquo;s Documents tab.
              </span>
            </div>
          )}
        </div>

        {data && step === 'select' && (
          <>
            {destinations.length > 1 && destination ? (
              <div className={`${styles.destination} ${styles.destinationPicker}`}>
                <label className={styles.destinationLabel} htmlFor={destinationSelectId}>
                  Faxing to
                </label>
                <select
                  id={destinationSelectId}
                  className={`sx-select ${styles.destinationSelect}`}
                  value={destination.id}
                  disabled={busy !== null}
                  onChange={(e) => {
                    setPickedDestinationId(e.target.value);
                    setError(null);
                    setProblems({});
                  }}
                >
                  {destinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} — Fax {d.faxNumberDisplay}
                      {d.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
                <span className={styles.destinationValue} aria-live="polite">
                  <strong>{destination.name}</strong> <span className={styles.faxNumber}>Fax {destination.faxNumberDisplay}</span>
                  {!destination.isDefault && <span className={styles.notDefault}>Not the default destination</span>}
                </span>
                {/* Phones (2026-11): a menu cuts long names off, so each destination is a full-width choice instead. Only one of the two controls is ever displayed. */}
                <fieldset className={styles.destinationChoices} disabled={busy !== null}>
                  <legend className={styles.destinationLabel}>Faxing to</legend>
                  {destinations.map((d) => (
                    <label key={d.id} className={`${styles.destinationChoice} ${d.id === destination.id ? styles.destinationChoiceOn : ''}`}>
                      <input
                        type="radio"
                        className={styles.checkbox}
                        name={`${destinationSelectId}-choice`}
                        value={d.id}
                        checked={d.id === destination.id}
                        onChange={() => {
                          setPickedDestinationId(d.id);
                          setError(null);
                          setProblems({});
                        }}
                      />
                      <span className={styles.destinationChoiceText}>
                        <span className={styles.destinationChoiceName}>{d.name}</span>
                        <span className={styles.faxNumber}>Fax {d.faxNumberDisplay}</span>
                      </span>
                      {d.isDefault && <span className={styles.defaultTag}>Default</span>}
                    </label>
                  ))}
                </fieldset>
              </div>
            ) : (
              <Destination name={destination?.name ?? data.destinationName} fax={destination?.faxNumberDisplay ?? data.destinationFax} />
            )}
            {cases.length === 0 ? (
              <div className={styles.empty}>
                <p className={styles.emptyTitle}>No applications are waiting to be faxed.</p>
                <p className={styles.muted}>Save a Manatee County application on a case and it will appear here.</p>
              </div>
            ) : (
              <div className={styles.selectLayout}>
                <section className={styles.casesPanel} aria-labelledby="fax-cases-heading">
                  <div className={styles.panelHead}>
                    <h3 id="fax-cases-heading" className={styles.panelTitle}>
                      Saved applications
                    </h3>
                    <span className={styles.count} aria-live="polite">
                      {selected.length} of {Math.min(availableCount, max)} selected
                    </span>
                  </div>
                  <ul className={styles.cases} aria-label="Saved applications">
                    {cases.map((c) => {
                      const position = selected.indexOf(c.caseId);
                      const checked = position >= 0;
                      const full = !checked && selected.length >= max;
                      const reason = problems[c.caseId] ?? c.reason;
                      const target = shortDate(c.targetDate);
                      return (
                        <li key={c.caseId} className={`${styles.case} ${checked ? styles.caseSelected : ''} ${!c.available ? styles.caseUnavailable : ''} ${problems[c.caseId] ? styles.caseProblem : ''}`}>
                          <label className={styles.caseLabel}>
                            <input type="checkbox" className={styles.checkbox} checked={checked} disabled={!c.available || full} onChange={(e) => toggle(c, e.target.checked)} aria-describedby={reason ? `fax-reason-${c.caseId}` : undefined} />
                            <span className={styles.caseText}>
                              <span className={styles.caseName}>{c.decedentDisplayName}</span>
                              <span className={styles.caseMeta}>
                                <span className={styles.caseNumber}>{c.caseNumber}</span>
                                <span aria-hidden="true"> · </span>
                                Application v{c.documentVersion ?? 1}
                                {target ? ` · send by ${target}` : ''}
                              </span>
                              {reason && (
                                <span id={`fax-reason-${c.caseId}`} className={problems[c.caseId] ? styles.problem : styles.reason}>
                                  {reason}
                                </span>
                              )}
                            </span>
                            {checked && (
                              <span className={styles.badge} aria-label={`Request ${position + 1}`}>
                                {position + 1}
                              </span>
                            )}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>

                <section className={styles.orderPanel} aria-label="Bundle order">
                  <div className={styles.panelHead}>
                    <h3 className={styles.panelTitle}>In this fax</h3>
                    {selected.length > 0 && (
                      <button type="button" className={styles.linkButton} onClick={() => setSelected([])}>
                        Clear
                      </button>
                    )}
                  </div>
                  {selected.length === 0 ? (
                    <p className={styles.muted}>Tick the applications to fax. They are faxed together, in the order shown here.</p>
                  ) : (
                    <>
                      <p className={styles.orderTitle}>
                        {plural(selected.length, 'application')} in one fax
                        {selected.length >= max ? ' (the most one bundle can hold)' : ''}
                      </p>
                      <ol className={styles.orderList}>
                        {selected.map((id, index) => {
                          const c = byId.get(id);
                          const name = c?.decedentDisplayName ?? id;
                          return (
                            <li key={id} className={styles.orderItem}>
                              <span className={styles.orderName}>
                                <strong>
                                  {index + 1} of {selected.length}
                                </strong>{' '}
                                {name}
                                {c && <span className={styles.orderNumber}> {c.caseNumber}</span>}
                              </span>
                              <span className={styles.orderActions}>
                                <button type="button" className="sx-icon-btn" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                                  ↑
                                </button>
                                <button type="button" className="sx-icon-btn" aria-label={`Move ${name} down`} disabled={index === selected.length - 1} onClick={() => move(index, 1)}>
                                  ↓
                                </button>
                                <button type="button" className="sx-icon-btn" aria-label={`Remove ${name}`} onClick={() => setSelected(selected.filter((x) => x !== id))}>
                                  ×
                                </button>
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    </>
                  )}
                </section>
              </div>
            )}
          </>
        )}

        {bundle && step === 'review' && (
          <div className={styles.reviewLayout}>
            <aside className={styles.reviewSide} aria-label="Fax details">
              <Destination name={bundle.destinationName} fax={bundle.destinationFax} />
              <dl className={styles.facts}>
                <div>
                  <dt>Document</dt>
                  <dd>
                    <span className={styles.fileName}>{bundle.reference}.pdf</span>
                    <span className={styles.muted}>{formatSize(bundle.sizeBytes)}</span>
                  </dd>
                </div>
                <div>
                  <dt>Applications</dt>
                  <dd>{bundle.applicationCount}</dd>
                </div>
                <div>
                  <dt>PDF pages</dt>
                  <dd>{bundle.pageCount}</dd>
                </div>
              </dl>
              <p className={styles.hint}>Check every page. The viewer shows the stored file Send Fax attaches, exactly as it will be faxed.</p>
              {destinations.length > 1 && <p className={styles.hint}>To fax it somewhere else, go back to cases and choose another destination — a new fax is prepared.</p>}
              <div className={styles.reviewOrder}>
                <h3 className={styles.panelTitle}>Order</h3>
                <ol className={styles.inlineList}>
                  {bundle.items.map((i) => (
                    <li key={i.caseId}>
                      <strong>{i.position}</strong> {i.decedentDisplayName} <span className={styles.orderNumber}>{i.caseNumber}</span>
                      {i.pageCount > 1 && <span className={styles.muted}> · {plural(i.pageCount, 'page')}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            </aside>
            <div className={styles.preview}>
              {/* The stored bundle PDF itself — the exact file Send Fax attaches. Every page is reachable from the controls above it. */}
              <PdfViewer url={faxBundlePdfUrl(organizationId, bundle.id)} fileName={`${bundle.reference}.pdf`} variant="review" className={styles.viewer} sections={sections} />
            </div>
          </div>
        )}

        {bundle && step === 'confirm' && (
          <div className={styles.confirmLayout}>
            <section className={styles.confirmCard} aria-labelledby="fax-confirm-heading">
              <h3 id="fax-confirm-heading" className={styles.confirmTitle}>
                Send this fax?
              </h3>
              <dl className={styles.confirmFacts}>
                <div>
                  <dt>To</dt>
                  <dd>
                    <strong>{bundle.destinationName}</strong>
                    <span className={styles.faxNumber}>Fax {bundle.destinationFax}</span>
                  </dd>
                </div>
                <div>
                  <dt>Document</dt>
                  <dd>
                    <strong className={styles.fileName}>{bundle.reference}.pdf</strong>
                    <span>
                      {plural(bundle.applicationCount, 'application')} · {plural(bundle.pageCount, 'PDF page')} · {formatSize(bundle.sizeBytes)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Applications</dt>
                  <dd>
                    <ol className={styles.inlineList}>
                      {bundle.items.map((i) => (
                        <li key={i.caseId}>
                          {i.position}. {i.decedentDisplayName} <span className={styles.orderNumber}>{i.caseNumber}</span>
                        </li>
                      ))}
                    </ol>
                  </dd>
                </div>
                <div>
                  <dt>How</dt>
                  <dd>
                    {bundle.senderAddress ? (
                      <span>
                        Emailed from <span className={styles.breakAll}>{bundle.senderAddress}</span> through Outlook to NuSo, which faxes it.
                      </span>
                    ) : (
                      <span className={styles.warn}>No Outlook mailbox is connected — an administrator can connect one in Settings → Crematory.</span>
                    )}
                    <span className={styles.muted}>
                      Subject: <span className={styles.breakAll}>{bundle.subject}</span>
                    </span>
                  </dd>
                </div>
              </dl>
              <p className={styles.deliveryNote}>
                Send Fax hands the fax to NuSo. It is <strong>not confirmed delivery</strong> — delivery is recorded from a case&rsquo;s Documents tab once NuSo reports the result.
              </p>
              <label className={`${styles.confirmCheck} ${sendingOff || uncertain || !bundle.senderAddress ? styles.confirmCheckOff : ''}`} htmlFor={confirmId}>
                <input id={confirmId} type="checkbox" className={styles.checkbox} checked={confirmed} disabled={busy !== null || uncertain || sendingOff || !bundle.senderAddress} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>
                  I reviewed all {plural(bundle.pageCount, 'page')} and want to fax {bundle.reference} to {bundle.destinationName} at {bundle.destinationFax}.
                </span>
              </label>
            </section>
          </div>
        )}

        {bundle && step === 'sent' && (
          <div className={styles.confirmLayout}>
            <section className={styles.sentCard} role="status">
              <h3 className={styles.confirmTitle}>Submitted to NuSo</h3>
              <p className={styles.sent}>
                Bundle {bundle.reference} — {plural(bundle.applicationCount, 'application')}, {plural(bundle.pageCount, 'page')} — was handed to NuSo for {bundle.destinationName} (fax {bundle.destinationFax}).
              </p>
              <p className={styles.deliveryNote}>
                This is <strong>not yet confirmed delivery</strong>: it is recorded from a case&rsquo;s Documents tab once NuSo reports the result.
              </p>
            </section>
          </div>
        )}
      </div>

      <div className="sx-modal-footer">
        {step === 'select' && (
          <>
            <span className="sx-modal-footer-note">{selected.length > 0 ? `${plural(selected.length, 'application')} selected` : 'Nothing is sent from this step.'}</span>
            <button type="button" className="sx-btn sx-btn-ghost" onClick={onClose}>
              Close
            </button>
            <button type="button" className="sx-btn sx-btn-primary" disabled={selected.length === 0 || busy !== null} onClick={() => void review()}>
              {busy === 'preview' ? 'Preparing fax…' : `Review fax${selected.length > 0 ? ` (${selected.length})` : ''}`}
            </button>
          </>
        )}
        {step === 'review' && (
          <>
            <span className="sx-modal-footer-note">Nothing is sent from this step.</span>
            <button type="button" className="sx-btn sx-btn-ghost" disabled={busy !== null} onClick={() => go('select')}>
              ‹ Back to cases
            </button>
            <button type="button" className="sx-btn sx-btn-primary" disabled={busy !== null} onClick={() => go('confirm')}>
              Continue to confirm
            </button>
          </>
        )}
        {step === 'confirm' && bundle && (
          <>
            <span className="sx-modal-footer-note">{sendingOff ? 'Fax sending is not turned on yet.' : !bundle.senderAddress ? 'No Outlook mailbox is connected.' : uncertain ? 'This fax cannot be sent again from here.' : confirmed ? 'Send Fax hands the fax to NuSo.' : 'Tick the confirmation to send.'}</span>
            <button type="button" className="sx-btn sx-btn-ghost" disabled={busy !== null} onClick={() => go('review')}>
              ‹ Back to review
            </button>
            <button type="button" className="sx-btn sx-btn-primary" disabled={!canSend} title={!bundle.sendingEnabled ? 'Fax sending is not turned on yet.' : !confirmed ? 'Tick the confirmation first.' : undefined} onClick={() => void send()}>
              {busy === 'send' ? 'Sending…' : 'Send Fax'}
            </button>
          </>
        )}
        {step === 'sent' && (
          <button type="button" className="sx-btn sx-btn-primary" onClick={onClose}>
            Done
          </button>
        )}
      </div>
    </Modal>
  );
}

function Destination({ name, fax }: { name: string; fax: string }) {
  return (
    <div className={styles.destination}>
      <span className={styles.destinationLabel}>Faxing to</span>
      <span className={styles.destinationValue}>
        <strong>{name}</strong> <span className={styles.faxNumber}>Fax {fax}</span>
      </span>
    </div>
  );
}
