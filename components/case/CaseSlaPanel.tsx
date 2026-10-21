'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Case } from '@/types/case';
import { SLA_DELAY_REASONS, SLA_EVENT_KEYS, type SlaDelayReason, type SlaEventKey, type SlaMilestoneKey } from '@/types/sla';
import {
  SLA_DELAY_REASON_LABEL,
  SLA_EVENT_LABEL,
  SLA_RESPONSIBLE_LABEL,
  SLA_STATUS_LABEL,
  delayHistory,
  describeDeadline,
  type CaseSlaEvaluation,
  type EventTime,
  type SlaMilestoneEvaluation,
} from '@/domain/sla/slaMilestones';
import { slaTone } from './CaseHeader';
import styles from './CaseSlaPanel.module.css';

/**
 * SLA tracking (2026-10) — the case's SLA details, collapsed under the
 * header so the header itself stays compact. Shows every milestone with its
 * start, deadline, status and recorded delays (history included), and lets
 * staff who can edit the case record what SOLIS cannot see for itself: when
 * the attestation arrived, when the state approved, when the crematory
 * received the decedent, and delays. The numbers come from the same
 * evaluation the header and the dashboard use.
 */

type SlaAction =
  | { action: 'record_event'; event: SlaEventKey; at: string }
  | { action: 'record_delay'; milestone: SlaMilestoneKey; reason: SlaDelayReason; notes: string | null; expectedResolutionDate: string | null }
  | { action: 'resolve_delay'; delayId: string };

async function postSlaAction(organizationId: string, caseId: string, body: SlaAction): Promise<Case | null> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/sla`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, ...body }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? 'The SLA update could not be saved.');
  return (result.case ?? null) as Case | null;
}

function formatEventTime(time: EventTime | null): string {
  if (!time) return 'Time not recorded';
  const date = new Date(`${time.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  if (time.minutes === null) return date;
  const h = Math.floor(time.minutes / 60);
  const m = time.minutes % 60;
  return `${date}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function formatDate(date: string | null): string {
  return date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';
}

export function CaseSlaPanel({
  case_,
  sla,
  organizationId,
  canEdit,
}: {
  case_: Case;
  sla: CaseSlaEvaluation;
  organizationId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [eventKey, setEventKey] = useState<SlaEventKey>('attestation_received');
  const [eventAt, setEventAt] = useState('');
  const [delayFor, setDelayFor] = useState<SlaMilestoneKey | null>(null);
  const [delayReason, setDelayReason] = useState<SlaDelayReason>('waiting_on_family');
  const [delayNotes, setDelayNotes] = useState('');
  const [delayExpected, setDelayExpected] = useState('');

  const mutation = useMutation({
    mutationFn: (body: SlaAction) => postSlaAction(organizationId, case_.id, body),
    onSuccess: (updated) => {
      if (updated) queryClient.setQueryData(['case', organizationId, case_.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['case', organizationId, case_.id] });
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
      setEventAt('');
      setDelayFor(null);
      setDelayNotes('');
      setDelayExpected('');
    },
  });

  const editable = canEdit && !case_.isDeleted;
  const visible = sla.milestones.filter((milestone) => milestone.state !== 'not_applicable');

  return (
    <section className={styles.panel} aria-label="SLA details">
      <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>SLA details</span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className={styles.body}>
          <ul className={styles.milestones}>
            {visible.map((milestone) => (
              <MilestoneRow
                key={milestone.key}
                milestone={milestone}
                history={delayHistory(case_, milestone.key)}
                editable={editable}
                busy={mutation.isPending}
                onRecordDelay={() => {
                  setDelayFor(milestone.key);
                  setDelayReason(milestone.external ? (milestone.responsibleParty === 'doctor' ? 'waiting_on_doctor' : milestone.responsibleParty === 'crematory' ? 'crematory_delay' : 'other') : 'waiting_on_family');
                }}
                onResolve={(delayId) => mutation.mutate({ action: 'resolve_delay', delayId })}
              />
            ))}
          </ul>

          {editable && delayFor && (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                mutation.mutate({
                  action: 'record_delay',
                  milestone: delayFor,
                  reason: delayReason,
                  notes: delayNotes.trim() || null,
                  expectedResolutionDate: delayExpected || null,
                });
              }}
            >
              <h4 className={styles.formTitle}>Record a delay — {visible.find((m) => m.key === delayFor)?.label}</h4>
              <p className={styles.hint}>A delay explains a wait. It never moves the deadline or clears an overdue status.</p>
              <div className={styles.formGrid}>
                <label className="sx-field">
                  <span className="sx-label">Reason</span>
                  <select className="sx-select" value={delayReason} onChange={(event) => setDelayReason(event.target.value as SlaDelayReason)}>
                    {SLA_DELAY_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {SLA_DELAY_REASON_LABEL[reason]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="sx-field">
                  <span className="sx-label">Expected resolution (optional)</span>
                  <input className="sx-input" type="date" value={delayExpected} onChange={(event) => setDelayExpected(event.target.value)} />
                </label>
              </div>
              <label className="sx-field" style={{ marginTop: 10 }}>
                <span className="sx-label">Notes (optional)</span>
                <textarea className="sx-textarea" style={{ height: 64, padding: 8 }} value={delayNotes} maxLength={1000} onChange={(event) => setDelayNotes(event.target.value)} />
              </label>
              <div className={styles.formActions}>
                <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => setDelayFor(null)} disabled={mutation.isPending}>
                  Cancel
                </button>
                <button type="submit" className="sx-btn sx-btn-primary sx-btn-sm" disabled={mutation.isPending}>
                  Save delay
                </button>
              </div>
            </form>
          )}

          {editable && (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                if (!eventAt) return;
                mutation.mutate({ action: 'record_event', event: eventKey, at: new Date(eventAt).toISOString() });
              }}
            >
              <h4 className={styles.formTitle}>Record a time</h4>
              <p className={styles.hint}>
                For what SOLIS cannot see for itself. Recording a Hard Save, EDRS submission or crematory send also completes its checklist item.
              </p>
              <div className={styles.formGrid}>
                <label className="sx-field">
                  <span className="sx-label">Event</span>
                  <select className="sx-select" value={eventKey} onChange={(event) => setEventKey(event.target.value as SlaEventKey)}>
                    {SLA_EVENT_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {SLA_EVENT_LABEL[key]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="sx-field">
                  <span className="sx-label">When</span>
                  <input className="sx-input" type="datetime-local" value={eventAt} onChange={(event) => setEventAt(event.target.value)} required />
                </label>
              </div>
              <div className={styles.formActions}>
                <button type="submit" className="sx-btn sx-btn-primary sx-btn-sm" disabled={mutation.isPending || !eventAt}>
                  {mutation.isPending ? 'Saving…' : 'Record'}
                </button>
              </div>
            </form>
          )}

          {mutation.isError && (
            <p className="sx-error-state" role="alert" style={{ marginTop: 10 }}>
              {(mutation.error as Error).message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function MilestoneRow({
  milestone,
  history,
  editable,
  busy,
  onRecordDelay,
  onResolve,
}: {
  milestone: SlaMilestoneEvaluation;
  history: ReturnType<typeof delayHistory>;
  editable: boolean;
  busy: boolean;
  onRecordDelay: () => void;
  onResolve: (delayId: string) => void;
}) {
  const tone = slaTone(milestone.status);
  const deadline = describeDeadline(milestone);
  return (
    <li className={styles.milestone}>
      <div className={styles.milestoneHead}>
        <span className={styles.milestoneLabel}>
          {milestone.label}
          {milestone.advisory && <span className={styles.advisory}> (reminder)</span>}
        </span>
        {milestone.status ? (
          <span className={`${styles.pill} ${styles[`pill_${tone}`]}`}>{SLA_STATUS_LABEL[milestone.status]}</span>
        ) : (
          <span className={styles.muted}>{milestone.state === 'not_started' ? 'Not started' : ''}</span>
        )}
        {milestone.overdue && milestone.status !== 'overdue' && <span className={`${styles.pill} ${styles.pill_bad}`}>Overdue</span>}
      </div>
      <dl className={styles.facts}>
        {milestone.startedAt !== null && (
          <div>
            <dt>Started</dt>
            <dd>{formatEventTime(milestone.startedAt)}</dd>
          </div>
        )}
        {milestone.deadline && (
          <div>
            <dt>Deadline</dt>
            <dd>
              {formatDate(milestone.deadline)}
              {milestone.state === 'active' && deadline ? ` · ${deadline}` : ''}
            </dd>
          </div>
        )}
        {milestone.state === 'completed' && (
          <div>
            <dt>Completed</dt>
            <dd>{formatEventTime(milestone.completedAt)}</dd>
          </div>
        )}
        {milestone.state === 'start_date_needed' && (
          <div>
            <dt>Start</dt>
            <dd>Start date needed — record when it began below.</dd>
          </div>
        )}
        {(milestone.state === 'active' || milestone.state === 'start_date_needed') && (
          <div>
            <dt>Responsible</dt>
            <dd>{SLA_RESPONSIBLE_LABEL[milestone.responsibleParty]}</dd>
          </div>
        )}
        {milestone.note && (
          <div>
            <dt>Note</dt>
            <dd>{milestone.note}</dd>
          </div>
        )}
      </dl>
      {history.length > 0 && (
        <ul className={styles.delays}>
          {history.map((delay) => (
            <li key={delay.id} className={delay.resolvedAt ? styles.delayResolved : undefined}>
              <strong>{SLA_DELAY_REASON_LABEL[delay.reason]}</strong> · {SLA_RESPONSIBLE_LABEL[delay.responsibleParty]}
              {delay.expectedResolutionDate ? ` · expected ${formatDate(delay.expectedResolutionDate)}` : ''}
              {delay.notes ? ` — ${delay.notes}` : ''}
              <span className={styles.muted}>
                {' '}
                (recorded {new Date(delay.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {delay.resolvedAt ? `; ${delay.resolution === 'superseded' ? 'replaced' : 'resolved'} ${new Date(delay.resolvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''})
              </span>
              {editable && !delay.resolvedAt && (
                <button type="button" className={`sx-btn sx-btn-ghost sx-btn-sm ${styles.inlineButton}`} onClick={() => onResolve(delay.id)} disabled={busy}>
                  Resolve
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (milestone.state === 'active' || milestone.state === 'start_date_needed') && (
        <button type="button" className={`sx-btn sx-btn-ghost sx-btn-sm ${styles.inlineButton}`} onClick={onRecordDelay} disabled={busy}>
          Record delay
        </button>
      )}
    </li>
  );
}
