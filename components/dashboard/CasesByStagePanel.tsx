'use client';

import styles from './CasesByStagePanel.module.css';

export type StageBarRow = {
  label: string;
  count: number;
  pct: number;
  selected: boolean;
};

/**
 * `rows` (count/percentage-of-max per stage) is computed by the page —
 * simple aggregation over already-derived CaseViewModel[], not a business
 * rule of its own (the stage list itself comes from domain/cases/stages.ts).
 * Clicking a row toggles that stage as the active filter (see
 * StageFilteredPanel) — the page owns that selection state.
 */
export function CasesByStagePanel({
  rows,
  onSelectStage,
}: {
  rows: StageBarRow[];
  onSelectStage: (index: number) => void;
}) {
  return (
    <div className={styles.panel}>
      <div className={styles.title}>Cases by stage</div>
      <div className={styles.rows}>
        {rows.map((row, index) => (
          <button
            key={row.label}
            type="button"
            className={`${styles.row} ${row.selected ? styles.rowSelected : ''}`}
            onClick={() => onSelectStage(index)}
          >
            <span className={styles.label}>{row.label}</span>
            <span className={styles.track}>
              {row.count > 0 && <span className={styles.fill} style={{ width: `${row.pct}%` }} />}
            </span>
            <span className={styles.count}>{row.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
