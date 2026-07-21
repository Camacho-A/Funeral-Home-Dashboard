import Link from 'next/link';
import { EmptyState } from '@/components/ui/EmptyState';
import type { VeteranCaseStatusRow } from '@/domain/reports/calculations';
import styles from './VeteranCasesPanel.module.css';

const STATUS_LABEL: Record<VeteranCaseStatusRow['status'], string> = {
  complete: 'Complete',
  in_progress: 'In progress',
};

export function VeteranCasesPanel({ rows }: { rows: VeteranCaseStatusRow[] }) {
  return (
    <div className={styles.panel}>
      <div className={styles.title}>Veteran / VA cases</div>
      <div className={styles.subtitle}>Cases flagged as armed forces — VA notification progress</div>
      {rows.length === 0 ? (
        <EmptyState message="No veteran cases on file." />
      ) : (
        <div className={styles.rows}>
          {rows.map((row) => (
            <Link key={row.caseId} href={`/cases/${row.caseId}`} className={styles.row}>
              <span className={styles.name}>{row.decedentName}</span>
              <span
                className={`${styles.status} ${row.status === 'complete' ? styles.statusComplete : styles.statusInProgress}`}
              >
                {STATUS_LABEL[row.status]}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
