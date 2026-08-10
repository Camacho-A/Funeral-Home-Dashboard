'use client';

import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useArAgingReport } from '@/hooks/useAccounting';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './AccountsReceivablePanel.module.css';

function formatCents(amount: number): string {
  return `$${(amount / 100).toFixed(2)}`;
}

const BUCKET_VARIANT: Record<string, 'neutral' | 'brand' | 'danger'> = {
  '0-30': 'neutral',
  '31-60': 'brand',
  '61-90': 'brand',
  '90+': 'danger',
};

/**
 * Phase 31 (Financial Management & General Ledger). "Invoices" — a view
 * over the existing `CaseOrder`/`PaymentRecord` data (no new invoice
 * entity, per ADR-035's conflict #1 resolution), aged from each case's v1
 * `CaseOrder`. Reports `reconciles` against the GL's own Accounts
 * Receivable balance — a cross-check surfaced to the user, never a
 * silently-hidden internal detail. Gated `accounting.report`.
 */
export function AccountsReceivablePanel() {
  const { organizationId } = useOrganization();
  const reportQuery = useArAgingReport(organizationId);
  const myPermissionsQuery = useMyPermissions(organizationId);

  if (reportQuery.isPending || myPermissionsQuery.isPending) {
    return <p>Loading accounts receivable…</p>;
  }

  const permissions = myPermissionsQuery.data?.permissions ?? [];
  if (!permissions.includes('accounting.report')) {
    return <EmptyState message="You don't have access to accounts receivable for this organization." />;
  }

  const report = reportQuery.data;
  if (!report || report.rows.length === 0) {
    return <EmptyState message="No open balances — every case is fully paid." />;
  }

  return (
    <div>
      <h2 className={styles.title}>Accounts Receivable</h2>
      <div className={styles.summary}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Total outstanding</span>
          <span className={styles.summaryValue}>{formatCents(report.totalOutstanding)}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>GL reconciliation</span>
          <Badge variant={report.reconciles ? 'success' : 'danger'}>{report.reconciles ? 'Matches GL' : 'Does not match GL'}</Badge>
        </div>
      </div>
      <Card className={styles.card}>
        <div className={styles.list}>
          {report.rows.map((row) => (
            <div key={row.caseOrderId} className={styles.row}>
              <div className={styles.identity}>
                <span className={styles.name}>Case {row.caseId}</span>
                <span className={styles.meta}>
                  {row.ageDays} day(s) old · anchored {row.anchorDate.slice(0, 10)}
                </span>
              </div>
              <Badge variant={BUCKET_VARIANT[row.bucket]}>{row.bucket}</Badge>
              <span className={styles.amount}>{formatCents(row.balanceDue)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
