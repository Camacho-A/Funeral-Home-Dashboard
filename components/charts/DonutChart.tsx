import styles from './charts.module.css';

export type DonutChartSlice = { label: string; value: number; variant?: 'brand' | 'success' | 'danger' | 'neutral' };

const VARIANT_CLASS: Record<NonNullable<DonutChartSlice['variant']>, string> = {
  brand: styles.sliceBrand,
  success: styles.sliceSuccess,
  danger: styles.sliceDanger,
  neutral: styles.sliceNeutral,
};

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). A hand-rolled
 * donut chart — same no-dependency, accessible-table-equivalent
 * discipline as `BarChart.tsx`. Built from stroke-dasharray arcs on a
 * single circle per slice; no path-data math beyond simple circumference
 * fractions.
 */
export function DonutChart({ slices, title }: { slices: DonutChartSlice[]; title: string }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offsetSoFar = 0;

  return (
    <div className={styles.chart}>
      <svg viewBox="0 0 100 100" className={styles.donutSvg} aria-hidden="true">
        <circle cx={50} cy={50} r={radius} className={styles.donutTrack} />
        {slices.map((slice) => {
          const fraction = slice.value / total;
          const dash = fraction * circumference;
          const dashArray = `${dash} ${circumference - dash}`;
          const dashOffset = -offsetSoFar;
          offsetSoFar += dash;
          return (
            <circle
              key={slice.label}
              cx={50}
              cy={50}
              r={radius}
              className={`${styles.donutSlice} ${VARIANT_CLASS[slice.variant ?? 'brand']}`}
              strokeDasharray={dashArray}
              strokeDashoffset={dashOffset}
            />
          );
        })}
      </svg>
      <table className={styles.srOnlyTable}>
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Value</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {slices.map((slice) => (
            <tr key={slice.label}>
              <th scope="row">{slice.label}</th>
              <td>{slice.value}</td>
              <td>{Math.round((slice.value / total) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className={styles.legend} aria-hidden="true">
        {slices.map((slice) => (
          <li key={slice.label} className={styles.legendRow}>
            <span className={`${styles.legendSwatch} ${VARIANT_CLASS[slice.variant ?? 'brand']}`} />
            <span className={styles.legendLabel}>{slice.label}</span>
            <span className={styles.legendValue}>{slice.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
