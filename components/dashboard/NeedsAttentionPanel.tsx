import Link from 'next/link';
import { toDisplayTitleCase } from '@/utils/string';
import styles from './NeedsAttentionPanel.module.css';

export type NeedsAttentionCase = {
  id: string;
  /** Phase 16B (Case Number Generation) — see AllCasesList's identical field. */
  caseNumber: string;
  decedentName: string;
  attentionReason: string;
  daysWaitingInStage: number;
  slaTargetLabel: string;
};

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
export function NeedsAttentionPanel({ cases }: { cases: NeedsAttentionCase[] }) {
  const hasAttention = cases.length > 0;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.title}>Needs attention</div>
        {hasAttention && <div className={styles.count}>{cases.length} cases</div>}
      </div>

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
              <span className={styles.reason}>{c.attentionReason}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
