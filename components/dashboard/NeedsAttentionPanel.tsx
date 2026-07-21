import Link from 'next/link';
import styles from './NeedsAttentionPanel.module.css';

export type NeedsAttentionCase = {
  id: string;
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
 */
export function NeedsAttentionPanel({ cases }: { cases: NeedsAttentionCase[] }) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.title}>Needs attention</div>
        <div className={styles.count}>{cases.length} cases</div>
      </div>
      <div className={styles.list}>
        {cases.map((c) => (
          <Link key={c.id} href={`/cases/${c.id}`} className={styles.row}>
            <div className={styles.rowMain}>
              <div className={styles.name}>{c.decedentName}</div>
              <div className={styles.reason}>{c.attentionReason}</div>
            </div>
            <div className={styles.meta}>
              <div className={styles.days}>{c.daysWaitingInStage}d</div>
              <div className={styles.expected}>expected {c.slaTargetLabel}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
