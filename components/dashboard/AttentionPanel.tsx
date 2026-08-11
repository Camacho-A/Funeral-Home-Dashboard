import Link from 'next/link';
import type { DashboardAttentionSection } from '@/services/dashboardService';
import styles from './AttentionPanel.module.css';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). The Dashboard's
 * "Attention" section — things needing action org-wide (distinct from
 * `NeedsAttentionPanel`, which is per-case and driven by `Case.isStalled`).
 * Every figure links to the report that explains it (this phase's own
 * "no dead-end dashboard numbers" rule) rather than a bare unexplained
 * count.
 */
export function AttentionPanel({ data }: { data: DashboardAttentionSection }) {
  const rows = [
    { label: 'Overdue cases', value: data.overdueCases, href: '/reports/sla-exceptions' },
    { label: 'Overdue tasks', value: data.overdueTasks, href: '/reports/open-overdue-tasks' },
    { label: 'Outstanding signatures', value: data.outstandingSignatures, href: '/reports/outstanding-signatures' },
    { label: 'Failed payments', value: data.failedPayments, href: '/reports/payment-history' },
  ];

  return (
    <div className={styles.panel}>
      <div className={styles.title}>Attention</div>
      <div className={styles.list}>
        {rows.map((row) => (
          <Link key={row.label} href={row.href} className={styles.row}>
            <span className={styles.label}>{row.label}</span>
            <span className={row.value > 0 ? styles.valueAlert : styles.value}>{row.value}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
