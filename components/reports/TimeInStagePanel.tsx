import type { StageBreakdownRow } from '@/domain/reports/calculations';
import styles from './TimeInStagePanel.module.css';

export function TimeInStagePanel({ rows }: { rows: StageBreakdownRow[] }) {
  return (
    <div className={styles.panel}>
      <div className={styles.title}>Time in stage</div>
      <div className={styles.subtitle}>
        Average days waiting vs. target — flags where delays are piling up
      </div>
      <div className={styles.rows}>
        {rows.map((row) => (
          <div key={row.label} className={styles.row}>
            <span className={styles.label}>{row.label}</span>
            <span className={`${styles.avg} ${row.avgColor === 'danger' ? styles.avgDanger : styles.avgNeutral}`}>
              {row.avgDays}d avg
            </span>
            <span className={styles.target}>target {row.targetLabel}</span>
            <span className={styles.count}>{row.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
