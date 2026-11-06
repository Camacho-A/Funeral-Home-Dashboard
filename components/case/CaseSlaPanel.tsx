'use client';

import { useState } from 'react';
import type { Case } from '@/types/case';
import {
  SLA_DELAY_REASON_LABEL,
  SLA_EVENT_SOURCE_LABEL,
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
 * header so the header itself stays compact. Read-only (2026-11): every
 * time comes from what SOLIS sees itself — the case's creation, checklist
 * ticks, the permit upload, the send to the crematory, the ashes picked up
 * and the release — so staff never record anything here. Only a milestone
 * in progress (or with an open delay) is a card; finished, never-recorded
 * and later milestones are one line each; the recorded times sit behind a
 * toggle.
 */

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

export function CaseSlaPanel({ case_, sla, compact = false }: { case_: Case; sla: CaseSlaEvaluation; /** In the case header, under the Current SLA line (2026-11): a small toggle, details in a card below it. */ compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [showTimes, setShowTimes] = useState(false);

  const visible = sla.milestones.filter((milestone) => milestone.state !== 'not_applicable');
  const needsAttention = (m: SlaMilestoneEvaluation) =>
    m.state === 'active' || m.state === 'start_date_needed' || m.overdue || delayHistory(case_, m.key).some((delay) => !delay.resolvedAt);
  const current = visible.filter(needsAttention);
  const completed = visible.filter((m) => m.state === 'completed' && !needsAttention(m));
  const notRecorded = visible.filter((m) => m.state === 'not_recorded' && !needsAttention(m));
  const later = visible.filter((m) => m.state === 'not_started' && !needsAttention(m));
  const timed = sla.events.filter((event) => event.occurred && event.time);

  return (
    <section className={compact ? styles.panelCompact : styles.panel} aria-label="SLA details">
      <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>SLA details</span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className={styles.body}>
          {current.length > 0 ? (
            <ul className={styles.milestones}>
              {current.map((milestone) => (
                <MilestoneRow key={milestone.key} milestone={milestone} history={delayHistory(case_, milestone.key)} />
              ))}
            </ul>
          ) : (
            <p className={styles.summaryLine}>Nothing needs attention right now.</p>
          )}

          {completed.length > 0 && (
            <p className={styles.summaryLine}>
              <span className={styles.summaryDone}>✓ Done:</span>{' '}
              {completed.map((m) => (m.completedAt ? `${m.label} (${formatEventTime(m.completedAt)})` : m.label)).join(' · ')}
            </p>
          )}
          {notRecorded.length > 0 && (
            <p className={styles.summaryLine}>
              <span className={styles.muted}>Not recorded:</span> {notRecorded.map((m) => m.label).join(' · ')}
            </p>
          )}
          {later.length > 0 && (
            <p className={styles.summaryLine}>
              <span className={styles.muted}>Later:</span> {later.map((m) => m.label).join(' · ')}
            </p>
          )}

          <button type="button" className={`sx-btn sx-btn-ghost sx-btn-sm ${styles.timesToggle}`} aria-expanded={showTimes} onClick={() => setShowTimes((value) => !value)}>
            {showTimes ? 'Hide recorded times' : 'Recorded times'}
          </button>

          {showTimes && (
            <div className={styles.timeline}>
              <h4 className={styles.formTitle}>Recorded times</h4>
              <ul>
                {timed.map((event) => (
                  <li key={event.key}>
                    <span>{event.label}</span>
                    <span>{formatEventTime(event.time)}</span>
                    <span className={styles.muted}>{event.source ? SLA_EVENT_SOURCE_LABEL[event.source] : ''}</span>
                  </li>
                ))}
                {timed.length === 0 && <li className={styles.muted}>No times recorded yet.</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function MilestoneRow({ milestone, history }: { milestone: SlaMilestoneEvaluation; history: ReturnType<typeof delayHistory> }) {
  const tone = slaTone(milestone.status);
  const deadline = describeDeadline(milestone);
  return (
    <li className={styles.milestone}>
      <div className={styles.milestoneHead}>
        <span className={styles.milestoneLabel}>
          {milestone.label}
          {milestone.advisory && <span className={styles.advisory}> (reminder)</span>}
        </span>
        {milestone.status && <span className={`${styles.pill} ${styles[`pill_${tone}`]}`}>{SLA_STATUS_LABEL[milestone.status]}</span>}
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
        {milestone.state === 'start_date_needed' && (
          <div>
            <dt>Start</dt>
            <dd>{milestone.note ?? 'Not known — this case started before SOLIS kept the time.'}</dd>
          </div>
        )}
        <div>
          <dt>Responsible</dt>
          <dd>{SLA_RESPONSIBLE_LABEL[milestone.responsibleParty]}</dd>
        </div>
        {milestone.note && milestone.state !== 'start_date_needed' && (
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
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
