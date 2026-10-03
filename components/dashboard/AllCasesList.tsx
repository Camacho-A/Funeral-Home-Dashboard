import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { toDisplayName } from '@/utils/displayName';
import type { BadgeVariant } from '@/types/caseViewModel';
import styles from './AllCasesList.module.css';

export type AllCasesListItem = {
  id: string;
  caseNumber: string;
  decedentName: string;
  decedentInitials: string;
  rowSummaryText: string;
  rowSummaryVariant: Extract<BadgeVariant, 'danger' | 'neutral'>;
  isOverdue: boolean;
  stageLabel: string;
  stageBadgeVariant: BadgeVariant;
  progressPercent: number;
};

/**
 * All Cases list — SOLIS Phase 2 (presentation only). Same data, same
 * server pagination, same Load More. Renders as a hairline table:
 * CASE | STAGE | PROGRESS. Names shown in title case via toDisplayName
 * (display only; stored values untouched).
 */
export function AllCasesList({
  cases,
  emptyMessage,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: {
  cases: AllCasesListItem[];
  emptyMessage: string;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <div className={styles.card}>
      {cases.length > 0 && (
        <div className={styles.headerRow} aria-hidden="true">
          <span>Case</span>
          <span>Stage</span>
          <span className={styles.headerRight}>Progress</span>
        </div>
      )}
      {cases.map((c) => (
        <Link key={c.id} href={`/cases/${c.id}`} className={styles.row}>
          <div className={styles.avatar}>{c.decedentInitials}</div>
          <div className={styles.main}>
            <div className={styles.identityCol}>
              <div className={styles.name}>{toDisplayName(c.decedentName)}</div>
              <div className={styles.caseNumber}>#{c.caseNumber}</div>
              <div
                className={`${styles.summary} ${c.rowSummaryVariant === 'danger' ? styles.summaryDanger : styles.summaryNeutral}`}
              >
                {c.rowSummaryText}
              </div>
            </div>
            <div className={styles.badges}>
              <div className={styles.badgeRow}>
                {c.isOverdue && <span className={styles.overdueTag}>overdue</span>}
                <Badge variant={c.stageBadgeVariant}>{c.stageLabel}</Badge>
              </div>
              <div className={styles.progressCol}>
                <ProgressBar percent={c.progressPercent} label={`${c.decedentName} workflow progress`} />
              </div>
            </div>
          </div>
        </Link>
      ))}
      {cases.length === 0 && <EmptyState message={emptyMessage} />}
      {hasMore && (
        <div className={styles.loadMoreRow}>
          <Button variant="secondary" onClick={onLoadMore} disabled={isLoadingMore}>
            {isLoadingMore ? 'Loading…' : 'Load More'}
          </Button>
        </div>
      )}
    </div>
  );
}
