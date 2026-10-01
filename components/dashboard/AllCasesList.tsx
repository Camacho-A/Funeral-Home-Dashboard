import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressBar } from '@/components/ui/ProgressBar';
import type { BadgeVariant } from '@/types/caseViewModel';
import styles from './AllCasesList.module.css';

export type AllCasesListItem = {
  id: string;
  /** Phase 16B (Case Number Generation) — displayed in every case list per
      "display the Case Number in all case lists and tables." */
  caseNumber: string;
  decedentName: string;
  /** Item #7 (2026-09, decedent avatar fix): the decedent's own initials —
      never the assigned staff owner's. See domain/cases/viewModel.ts's
      resolveDecedentInitials. */
  decedentInitials: string;
  rowSummaryText: string;
  rowSummaryVariant: Extract<BadgeVariant, 'danger' | 'neutral'>;
  isOverdue: boolean;
  stageLabel: string;
  stageBadgeVariant: BadgeVariant;
  /** Case list scalability, Phase 3 (progress indicator, 2026-09) — see
      domain/cases/progress.ts. All Cases spans every stage, so the stage
      badge above stays the ONLY "where is it" signal; this is purely
      "how much of the whole workflow is actually done." */
  progressPercent: number;
};

/**
 * The "All Cases" tab's case list (Case list scalability, Phase 3,
 * 2026-09) — renders one bounded, server-paginated page at a time
 * (hooks/useCaseListPage.ts), never a client-side-filtered full dataset.
 * All filtering/sorting/pagination happens server-side; this only renders
 * what it's given plus the "Load More" control for the next page.
 */
export function AllCasesList({
  cases,
  emptyMessage,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: {
  cases: AllCasesListItem[];
  /** Shown only when `cases` is empty — the page decides the exact
      wording (search-no-matches vs. genuinely-empty), since that
      distinction depends on state (searchQuery) this component doesn't
      otherwise need to know about. */
  emptyMessage: string;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <div className={styles.card}>
      {cases.map((c) => (
        <Link key={c.id} href={`/cases/${c.id}`} className={styles.row}>
          <div className={styles.avatar}>{c.decedentInitials}</div>
          <div className={styles.main}>
            <div>
              <div className={styles.name}>{c.decedentName}</div>
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
              <ProgressBar percent={c.progressPercent} label={`${c.decedentName} workflow progress`} />
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
