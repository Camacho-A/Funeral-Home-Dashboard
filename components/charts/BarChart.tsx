import styles from './charts.module.css';

export type BarChartRow = { label: string; value: number };

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). A hand-rolled,
 * minimal horizontal bar chart — no charting library dependency (per this
 * phase's own decision; this codebase has never had one). Every chart
 * ships with an accessible tabular equivalent: the `<table>` here is the
 * one screen readers/assistive tech actually see (`aria-hidden` on the
 * SVG), never a decorative-only visual with no textual equivalent.
 */
export function BarChart({ rows, unit = '', title }: { rows: BarChartRow[]; unit?: string; title: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));

  // UI refresh (2026-11): one row per category — label, bar, value — so
  // each bar is read next to what it measures (it used to be a block of
  // unlabelled bars above a separate list of labels).
  return (
    <div className={styles.chart}>
      <div className={styles.barRows} aria-hidden="true">
        {rows.map((row) => (
          <div key={row.label} className={styles.barRow}>
            <span className={styles.barRowLabel}>{row.label}</span>
            <span className={styles.barTrack}>
              <svg viewBox="0 0 100 10" preserveAspectRatio="none" className={styles.barSvg} aria-hidden="true">
                <rect x={0} y={0} width={Math.max(row.value > 0 ? 1.5 : 0, (row.value / max) * 100)} height={10} className={styles.bar} />
              </svg>
            </span>
            <span className={styles.barRowValue}>
              {row.value}
              {unit ? ` ${unit}` : ''}
            </span>
          </div>
        ))}
      </div>
      <table className={styles.srOnlyTable}>
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Value{unit ? ` (${unit})` : ''}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
