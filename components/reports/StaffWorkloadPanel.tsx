import type { StaffWorkloadRow } from '@/domain/reports/calculations';
import styles from './StaffWorkloadPanel.module.css';

export function StaffWorkloadPanel({ rows }: { rows: StaffWorkloadRow[] }) {
  return (
    <div className={styles.panel}>
      <div className={styles.title}>Staff workload</div>
      <div className={styles.rows}>
        {rows.map((row) => (
          <div key={row.staffId} className={styles.row}>
            <span className={styles.name}>{row.name}</span>
            <div className={styles.counts}>
              <span className={styles.active}>{row.activeCaseCount} active</span>
              {row.overdueCaseCount > 0 && (
                <span className={styles.overdue}>{row.overdueCaseCount} overdue</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
