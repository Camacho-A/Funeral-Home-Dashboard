import Link from 'next/link';
import { toDisplayTitleCase } from '@/utils/string';
import styles from './NeedsAttentionPanel.module.css';
import {
  SLA_DELAY_REASON_LABEL,
  SLA_RESPONSIBLE_LABEL,
  SLA_STATUS_LABEL,
  describeDeadline,
  slaNeedsAttention,
  type CaseSlaEvaluation,
  type SlaMilestoneEvaluation,
} from '@/domain/sla/slaMilestones';

export type NeedsAttentionCase = {
  id: string;
  /** Phase 16B (Case Number Generation) — see AllCasesList's identical field. */
  caseNumber: string;
  decedentName: string;
  attentionReason: string;
  daysWaitingInStage: number;
  slaTargetLabel: string;
  /** SLA tracking (2026-10): the case's current milestone, when the case is
      here because of it. Absent for organizations without SLA tracking. */
  sla?: CaseSlaEvaluation | null;
};

export type SlaSummaryCounts = { onTrack: number; dueToday: number; overdue: number; waiting: number; startDateNeeded?: number };

/**
 * `cases` is already the filtered/derived list (built by the page from
 * CaseViewModel[] — see docs/BUSINESS_RULES.md's "Needs Attention" rule for
 * why this is driven by `needsAttention` alone, not overdue or veteran
 * status independently). Purely presentational: no filtering happens here.
 *
 * SOLIS true redesign, Phase 1 (2026-10). The old zero-state rendered a
 * large half-width card showing only "0 cases" — the approved design's
 * own fix: a compact, calm "All caught up" row, no card, no wasted
 * space. The non-zero state drops the per-row card/left-accent-bar
 * wrapper for a plain hairline-divided list (a small red dot carries the
 * "needs attention" signal instead of a colored card edge) and drops the
 * days/SLA meta column from the row itself, per the approved design's own
 * compact row shape — that data isn't removed from the app (still real,
 * still on `NeedsAttentionCase`/CaseViewModel, still computed exactly as
 * before), just not repeated on this particular row; it remains visible
 * on Case Detail and the stage-filtered case list.
 */
export function NeedsAttentionPanel({ cases, slaSummary }: { cases: NeedsAttentionCase[]; slaSummary?: SlaSummaryCounts | null }) {
  const hasAttention = cases.length > 0;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.title}>Needs attention</div>
        {hasAttention && <div className={styles.count}>{cases.length} cases</div>}
      </div>

      {/* SLA tracking (2026-10): compact counts across active cases. */}
      {slaSummary && (
        <dl className={styles.slaSummary} aria-label="SLA summary">
          <div className={styles.slaCount} data-tone="ok">
            <dt>On track</dt>
            <dd>{slaSummary.onTrack}</dd>
          </div>
          <div className={styles.slaCount} data-tone="warn">
            <dt>Due today</dt>
            <dd>{slaSummary.dueToday}</dd>
          </div>
          <div className={styles.slaCount} data-tone="bad">
            <dt>Overdue</dt>
            <dd>{slaSummary.overdue}</dd>
          </div>
          <div className={styles.slaCount} data-tone="neutral">
            <dt>Waiting on others</dt>
            <dd>{slaSummary.waiting}</dd>
          </div>
        </dl>
      )}
      {slaSummary && (slaSummary.startDateNeeded ?? 0) > 0 && (
        <p className={styles.slaHint}>
          {slaSummary.startDateNeeded} case{slaSummary.startDateNeeded === 1 ? '' : 's'} need an SLA start date — open the case and record it in SLA details.
        </p>
      )}

      {!hasAttention && (
        <div className={styles.caughtUp}>
          <span className={styles.caughtUpCheck} aria-hidden="true">
            ✓
          </span>
          <span className={styles.caughtUpTitle}>All caught up</span>
          <span className={styles.caughtUpSubtitle}>No cases need attention right now.</span>
        </div>
      )}

      {hasAttention && (
        <div className={styles.list}>
          {cases.map((c) => (
            <Link key={c.id} href={`/cases/${c.id}`} className={styles.row}>
              <span className={styles.dot} aria-hidden="true" />
              <span className={styles.caseNumber}>{c.caseNumber}</span>
              <span className={styles.name}>{toDisplayTitleCase(c.decedentName)}</span>
              {/* The SLA detail only when the SLA is why the case is here; a
                  stalled case keeps its own reason. */}
              {c.sla?.current && slaNeedsAttention(c.sla.current) ? (
                <SlaRowDetail milestone={c.sla.current} />
              ) : (
                <span className={styles.reason}>{c.attentionReason}</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDeadline(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** SLA tracking (2026-10): milestone, deadline, days left or overdue,
    who is responsible, and any recorded delay — in one wrapping line. */
function SlaRowDetail({ milestone }: { milestone: SlaMilestoneEvaluation }) {
  const tone = milestone.status === 'overdue' ? 'bad' : milestone.status === 'due_today' || milestone.status === 'due_soon' ? 'warn' : 'neutral';
  const deadline = describeDeadline(milestone);
  return (
    <span className={styles.slaDetail}>
      <span className={styles.slaStatus} data-tone={tone}>
        {SLA_STATUS_LABEL[milestone.status!]}
      </span>
      {milestone.overdue && milestone.status !== 'overdue' && (
        <span className={styles.slaStatus} data-tone="bad">
          Overdue
        </span>
      )}
      <span className={styles.reason}>
        {milestone.label}
        {milestone.deadline ? ` · due ${formatDeadline(milestone.deadline)}` : ''}
        {deadline && milestone.state === 'active' ? ` · ${deadline}` : milestone.state === 'start_date_needed' ? ' · start date needed' : ''}
        {` · ${SLA_RESPONSIBLE_LABEL[milestone.responsibleParty]}`}
        {milestone.delay ? ` · ${SLA_DELAY_REASON_LABEL[milestone.delay.reason]}` : ''}
      </span>
    </span>
  );
}
