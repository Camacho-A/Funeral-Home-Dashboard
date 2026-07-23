import Link from 'next/link';
import { Checkbox } from '@/components/ui/Checkbox';
import type { BadgeVariant } from '@/types/caseViewModel';
import { BulkActionBar } from './BulkActionBar';
import styles from './StageFilteredPanel.module.css';

export type StageFilteredCase = {
  id: string;
  /** Phase 16B (Case Number Generation) — see AllCasesList's identical field. */
  caseNumber: string;
  decedentName: string;
  ownerInitials: string;
  rowSummaryText: string;
  rowSummaryVariant: Extract<BadgeVariant, 'danger' | 'neutral'>;
  isStalled: boolean;
  selected: boolean;
};

/**
 * Shown when a Cases-by-stage bar is clicked (see CasesByStagePanel).
 * Bulk-select state and the advance mutation are owned by the page;
 * this only renders rows and forwards the interactions.
 */
export function StageFilteredPanel({
  stageLabel,
  cases,
  selectedCount,
  onToggleSelect,
  onAdvance,
  onBack,
}: {
  stageLabel: string;
  cases: StageFilteredCase[];
  selectedCount: number;
  onToggleSelect: (caseId: string) => void;
  onAdvance: () => void;
  onBack: () => void;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.title}>{stageLabel}</div>
        <div className={styles.headerActions}>
          <BulkActionBar selectedCount={selectedCount} onAdvance={onAdvance} />
          <button type="button" className={styles.backLink} onClick={onBack}>
            ← back to all cases
          </button>
        </div>
      </div>
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
              {c.ownerInitials}
            </Link>
            <Link href={`/cases/${c.id}`} className={styles.main}>
              <div className={styles.name}>
                {c.decedentName} <span className={styles.caseNumber}>#{c.caseNumber}</span>
              </div>
              <div
                className={`${styles.summary} ${c.rowSummaryVariant === 'danger' ? styles.summaryDanger : styles.summaryNeutral}`}
              >
                {c.rowSummaryText}
              </div>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
