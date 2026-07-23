import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import type { BadgeVariant } from '@/types/caseViewModel';
import styles from './AllCasesList.module.css';

export type AllCasesListItem = {
  id: string;
  /** Phase 16B (Case Number Generation) — displayed in every case list per
      "display the Case Number in all case lists and tables." */
  caseNumber: string;
  decedentName: string;
  ownerInitials: string;
  rowSummaryText: string;
  rowSummaryVariant: Extract<BadgeVariant, 'danger' | 'neutral'>;
  isOverdue: boolean;
  stageLabel: string;
  stageBadgeVariant: BadgeVariant;
};

/**
 * The full, search-filtered (and stalled-first-sorted) case list — hidden
 * by the page while a stage filter is active, matching the prototype's
 * showAllCasesList/searchFilteredCases behavior. All filtering/sorting
 * happens in the page/hooks layer; this only renders what it's given.
 */
export function AllCasesList({
  cases,
  searchQuery,
}: {
  cases: AllCasesListItem[];
  searchQuery: string;
}) {
  return (
    <>
      <div className={styles.sectionLabel}>All cases</div>
      <div className={styles.card}>
        {cases.map((c) => (
          <Link key={c.id} href={`/cases/${c.id}`} className={styles.row}>
            <div className={styles.avatar}>{c.ownerInitials}</div>
            <div className={styles.main}>
              <div>
                <div className={styles.name}>
                  {c.decedentName} <span className={styles.caseNumber}>#{c.caseNumber}</span>
                </div>
                <div
                  className={`${styles.summary} ${c.rowSummaryVariant === 'danger' ? styles.summaryDanger : styles.summaryNeutral}`}
                >
                  {c.rowSummaryText}
                </div>
              </div>
              <div className={styles.badges}>
                {c.isOverdue && <span className={styles.overdueTag}>overdue</span>}
                <Badge variant={c.stageBadgeVariant}>{c.stageLabel}</Badge>
              </div>
            </div>
          </Link>
        ))}
        {cases.length === 0 && searchQuery.length > 0 && (
          <EmptyState message={`No cases match "${searchQuery}"`} />
        )}
      </div>
    </>
  );
}
