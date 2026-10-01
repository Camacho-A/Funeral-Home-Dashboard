import Link from 'next/link';
import styles from './CasesByStagePanel.module.css';

export type StageBarRow = {
  label: string;
  /** `null` while the server-side counts query is still loading — see
      app/api/cases/counts/route.ts. Never computed by downloading every
      Case object. */
  count: number | null;
  /** Bar-fill percentage relative to the highest stage count, 0-100. */
  pct: number;
};

/**
 * Dashboard navigation hub (Case list scalability, Phase 3 — UX
 * correction, 2026-09). Previously this panel owned local "selected
 * stage" state and fed an in-place case list elsewhere on the Dashboard
 * (an 8-tab bar + rendered case cards). That direction was explicitly
 * reversed: the Dashboard must stay a fixed-height summary regardless of
 * how many cases exist, so every row here is now pure navigation — a
 * `<Link>` to the dedicated case-list route (`/cases`, optionally
 * `?stage=<STAGES label>`) — rather than a local filter toggle. The
 * actual case results render there, never inside this panel.
 *
 * `rows`/`allCasesCount` come from the Phase 2 counts endpoint
 * (hooks/useCaseCounts.ts) — never a client-side aggregation over a
 * fully-downloaded case list, so this panel's cost stays flat no matter
 * how many cases the organization has.
 */
export function CasesByStagePanel({
  allCasesCount,
  rows,
}: {
  /** `null` while counts are still loading. */
  allCasesCount: number | null;
  rows: StageBarRow[];
}) {
  return (
    <div className={styles.panel}>
      <div className={styles.title}>Cases by stage</div>

      <Link href="/cases" className={styles.allCasesRow}>
        <span className={styles.allCasesLabel}>All Cases</span>
        <span className={styles.allCasesCount}>{allCasesCount ?? ''}</span>
      </Link>

      <div className={styles.rows}>
        {rows.map((row) => (
          <Link key={row.label} href={{ pathname: '/cases', query: { stage: row.label } }} className={styles.row}>
            <span className={styles.label}>{row.label}</span>
            <span className={styles.track}>
              {row.count !== null && row.count > 0 && (
                <span className={styles.fill} style={{ width: `${row.pct}%` }} />
              )}
            </span>
            <span className={styles.count}>{row.count ?? ''}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
