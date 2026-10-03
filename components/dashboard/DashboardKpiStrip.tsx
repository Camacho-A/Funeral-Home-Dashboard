import Link from 'next/link';
import type { DashboardFinancialSection } from '@/services/dashboardService';
import { formatCentsAsCurrency } from '@/utils/format';
import styles from './DashboardKpiStrip.module.css';

/**
 * SOLIS true redesign, Phase 1 (2026-10). Replaces the prior separate
 * "Financial summary" card (FinancialSummaryPanel, deleted — its entire
 * responsibility moves here) plus the greeting subtitle's own active-case
 * count with the approved design's single hairline-divided KPI strip: the
 * five numbers SOLIS already computes (Active cases, Needs attention,
 * Gross revenue, Cash collected, Accounts receivable), not a sixth
 * invented metric. Every figure is the exact value the Dashboard already
 * had — `activeCases`/`attentionCount` from the page's own already-fetched
 * `kpis`/`urgentCases` (NeedsAttentionPanel's own data), `financial` from
 * `useDashboardData` (unchanged query/permission gating).
 *
 * Currency fix (per the approved design's own "Currency" Implementation
 * Note — "uses the existing formatter if there is one"): the old
 * FinancialSummaryPanel had its own local `formatCents` with no thousands
 * separator ("$2340.00"); this uses the real, existing
 * `utils/format.ts#formatCentsAsCurrency` (Intl.NumberFormat) instead.
 * Calculations are completely unchanged — only the string formatting.
 *
 * `financial === null` (the caller lacks `accounting.report`) renders only
 * the two cells every role can see — no empty box, exactly like the old
 * panel's own "collapses entirely" behavior for that case. `isError` shows
 * the same two cells plus a quiet inline notice, never a missing section
 * with no explanation.
 */
export function DashboardKpiStrip({
  activeCases,
  attentionCount,
  financial,
  isLoading,
  isError,
}: {
  activeCases: number;
  attentionCount: number;
  financial: DashboardFinancialSection | null;
  isLoading: boolean;
  isError: boolean;
}) {
  const showFinancialCells = isLoading || isError || financial !== null;

  return (
    <div>
      <div className={`${styles.strip} ${showFinancialCells ? styles.cols5 : styles.cols2}`}>
        <div className={styles.cell}>
          <div className={styles.label}>Active cases</div>
          <div className={styles.value}>{activeCases}</div>
        </div>
        <div className={styles.cell}>
          <div className={styles.label}>Needs attention</div>
          <div className={`${styles.value} ${attentionCount > 0 ? styles.valueAttention : ''}`}>{attentionCount}</div>
        </div>
        {showFinancialCells && (
          <>
            <Link href="/reports/revenue-summary" className={styles.cell}>
              <div className={styles.label}>Gross revenue</div>
              <div className={styles.value}>{isLoading || isError || !financial ? '—' : formatCentsAsCurrency(financial.grossRevenue, 'usd')}</div>
            </Link>
            <Link href="/reports/collections-summary" className={styles.cell}>
              <div className={styles.label}>Cash collected</div>
              <div className={styles.value}>{isLoading || isError || !financial ? '—' : formatCentsAsCurrency(financial.cashCollected, 'usd')}</div>
            </Link>
            <Link href="/reports/outstanding-balance" className={styles.cell}>
              <div className={styles.label}>Accounts receivable</div>
              <div className={styles.value}>{isLoading || isError || !financial ? '—' : formatCentsAsCurrency(financial.accountsReceivableTotal, 'usd')}</div>
            </Link>
          </>
        )}
      </div>
      {isError && <div className={styles.notice}>Unable to load the financial summary right now.</div>}
    </div>
  );
}
