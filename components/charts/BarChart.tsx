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

  return (
    <div className={styles.chart}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={styles.barSvg} aria-hidden="true">
        {rows.map((row, index) => {
          const rowHeight = 100 / rows.length;
          const barHeight = rowHeight * 0.6;
          const y = index * rowHeight + (rowHeight - barHeight) / 2;
          const width = (row.value / max) * 100;
          return <rect key={row.label} x={0} y={y} width={width} height={barHeight} className={styles.bar} />;
        })}
      </svg>
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
      <div className={styles.barLabels} aria-hidden="true">
        {rows.map((row) => (
          <div key={row.label} className={styles.barLabelRow}>
            <span className={styles.barLabel}>{row.label}</span>
            <span className={styles.barValue}>
              {row.value}
              {unit ? ` ${unit}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
