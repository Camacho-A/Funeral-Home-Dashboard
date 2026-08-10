'use client';

import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useBalanceSheetReport, useArAgingReport, useJournalEntries } from '@/hooks/useAccounting';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './AccountingDashboardPanel.module.css';

function formatCents(amount: number): string {
  return `$${(amount / 100).toFixed(2)}`;
}

/**
 * Phase 31 (Financial Management & General Ledger). The Accounting
 * subsystem's landing page: cash position (Balance Sheet's own asset
 * total — every derived account balance, never a stored figure), open AR,
 * and manual entries still awaiting review/posting. Gated
 * `accounting.view`.
 */
export function AccountingDashboardPanel() {
  const { organizationId } = useOrganization();
  const myPermissionsQuery = useMyPermissions(organizationId);
  const balanceSheetQuery = useBalanceSheetReport(organizationId);
  const arAgingQuery = useArAgingReport(organizationId);
  const journalEntriesQuery = useJournalEntries(organizationId);

  if (myPermissionsQuery.isPending || balanceSheetQuery.isPending || arAgingQuery.isPending || journalEntriesQuery.isPending) {
    return <p>Loading accounting dashboard…</p>;
  }

  const permissions = myPermissionsQuery.data?.permissions ?? [];
  if (!permissions.includes('accounting.view')) {
    return <EmptyState message="You don't have access to the accounting dashboard for this organization." />;
  }

  const cashPosition = (balanceSheetQuery.data?.assets ?? []).reduce((sum, line) => sum + line.amount, 0);
  const openAr = arAgingQuery.data?.totalOutstanding ?? 0;
  const draftEntries = (journalEntriesQuery.data ?? []).filter((e) => e.status === 'draft');

  return (
    <div>
      <h2 className={styles.title}>Accounting</h2>
      <div className={styles.stats}>
        <Card variant="elevated" className={styles.statCard}>
          <span className={styles.statLabel}>Cash position</span>
          <span className={styles.statValue}>{formatCents(cashPosition)}</span>
        </Card>
        <Card variant="elevated" className={styles.statCard}>
          <span className={styles.statLabel}>Open accounts receivable</span>
          <span className={styles.statValue}>{formatCents(openAr)}</span>
        </Card>
        <Card variant="elevated" className={styles.statCard}>
          <span className={styles.statLabel}>Entries pending review</span>
          <span className={styles.statValue}>{draftEntries.length}</span>
        </Card>
      </div>

      <h3 className={styles.sectionTitle}>Drafts pending review</h3>
      {draftEntries.length === 0 ? (
        <EmptyState message="No manual entries are waiting for review." />
      ) : (
        <Card className={styles.card}>
          <div className={styles.list}>
            {draftEntries.map((entry) => (
              <div key={entry.id} className={styles.row}>
                <div className={styles.identity}>
                  <span className={styles.name}>{entry.memo}</span>
                  <span className={styles.meta}>{entry.entryDate.slice(0, 10)}</span>
                </div>
                <Badge variant="neutral">draft</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
