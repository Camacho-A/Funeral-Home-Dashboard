import Link from 'next/link';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressBar } from '@/components/ui/ProgressBar';
import type { BadgeVariant } from '@/types/caseViewModel';
import { BulkActionBar } from './BulkActionBar';
import styles from './StageFilteredPanel.module.css';

export type StageFilteredCase = {
  id: string;
  /** Phase 16B (Case Number Generation) — see AllCasesList's identical field. */
  caseNumber: string;
  decedentName: string;
  /** Item #7 (2026-09, decedent avatar fix): the decedent's own initials —
      never the assigned staff owner's. See domain/cases/viewModel.ts's
      resolveDecedentInitials. */
  decedentInitials: string;
  rowSummaryText: string;
  rowSummaryVariant: Extract<BadgeVariant, 'danger' | 'neutral'>;
  isStalled: boolean;
  selected: boolean;
  /** Case list scalability, Phase 3 (progress indicator, 2026-09) — see
      domain/cases/progress.ts. Every row here is already known to be in
      the same stage (no stage badge is shown for that reason — see this
      component's own doc comment), so this is the one piece of per-case
      status this list adds: how much of the whole workflow is done. */
  progressPercent: number;
};

/**
 * A single workflow-stage tab's case list (Case list scalability, Phase
 * 3, 2026-09) — one bounded, server-paginated page at a time
 * (hooks/useCaseListPage.ts), with the bulk "select + advance to next
 * stage" action this panel has always owned. The "← back to all cases"
 * link/title header from the pre-tabs design is gone — the active tab
 * itself is now what communicates "you're viewing Completed," and
 * switching away is just clicking a different tab, not a one-way drill-in
 * `onBack` had to undo. Bulk-select state and the advance mutation are
 * still owned by the page; this only renders rows and forwards the
 * interactions, plus the new "Load More" control for the next page.
 */
export function StageFilteredPanel({
  cases,
  emptyMessage,
  selectedCount,
  onToggleSelect,
  onAdvance,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: {
  cases: StageFilteredCase[];
  /** Shown only when `cases` is empty — see AllCasesList's identical prop
      for why the exact wording is the page's call, not this component's. */
  emptyMessage: string;
  selectedCount: number;
  onToggleSelect: (caseId: string) => void;
  onAdvance: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <div className={styles.card}>
      {selectedCount > 0 && (
        <div className={styles.header}>
          <BulkActionBar selectedCount={selectedCount} onAdvance={onAdvance} />
        </div>
      )}
      <div className={styles.list}>
        {cases.map((c) => (
          <div key={c.id} className={`${styles.row} ${c.isStalled ? styles.rowStalled : ''}`}>
            <Checkbox
              checked={c.selected}
              onChange={() => onToggleSelect(c.id)}
              tone="brand"
              aria-label={`Select ${c.decedentName}`}
            />
            <Link href={`/cases/${c.id}`} className={styles.avatar}>
              {c.decedentInitials}
            </Link>
            <Link href={`/cases/${c.id}`} className={styles.main}>
              <div className={styles.name}>{c.decedentName}</div>
              <div className={styles.caseNumber}>#{c.caseNumber}</div>
              <div
                className={`${styles.summary} ${c.rowSummaryVariant === 'danger' ? styles.summaryDanger : styles.summaryNeutral}`}
              >
                {c.rowSummaryText}
              </div>
            </Link>
            <div className={styles.progress}>
              <ProgressBar percent={c.progressPercent} label={`${c.decedentName} workflow progress`} />
            </div>
          </div>
        ))}
      </div>
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
