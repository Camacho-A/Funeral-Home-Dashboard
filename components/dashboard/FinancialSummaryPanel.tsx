import Link from 'next/link';
import type { DashboardFinancialSection } from '@/services/dashboardService';
import styles from './FinancialSummaryPanel.module.css';

function formatCents(amount: number): string {
  return `$${(amount / 100).toFixed(2)}`;
}

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). The Dashboard's
 * "Financial" section — renders exactly what `dashboardService.getDashboard`
 * already computed (gated `accounting.report` server-side); never `null`
 * checked here beyond "don't render if the section itself is null," since
 * the caller already decided visibility. Each figure links to its own
 * Report Viewer instance rather than dead-ending (this phase's own
 * "no dead-end dashboard numbers" rule).
 */
export function FinancialSummaryPanel({ data }: { data: DashboardFinancialSection }) {
  return (
    <div className={styles.panel}>
      <div className={styles.title}>Financial summary</div>
      <div className={styles.grid}>
        <Link href="/reports/revenue-summary" className={styles.stat}>
          <span className={styles.label}>Gross revenue</span>
          <span className={styles.value}>{formatCents(data.grossRevenue)}</span>
        </Link>
        <Link href="/reports/collections-summary" className={styles.stat}>
          <span className={styles.label}>Cash collected</span>
          <span className={styles.value}>{formatCents(data.cashCollected)}</span>
        </Link>
        <Link href="/reports/outstanding-balance" className={styles.stat}>
          <span className={styles.label}>Accounts receivable</span>
          <span className={styles.value}>{formatCents(data.accountsReceivableTotal)}</span>
        </Link>
      </div>
    </div>
  );
}
