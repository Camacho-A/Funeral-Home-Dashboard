import type { MetricDataType } from '@/domain/reporting/metricRegistry';

// SOLIS Final Phase §0.5 — display-only currency formatting.
const CURRENCY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function formatValue(value: unknown, dataType: MetricDataType, unit: string): string {
  if (Array.isArray(value)) return `${value.length} rows`;
  if (typeof value !== 'number') return String(value);
  if (dataType === 'currency') return CURRENCY.format(value / 100);
  if (dataType === 'percentage') return `${value}%`;
  if (dataType === 'days') return `${value} ${value === 1 ? 'day' : 'days'}`;
  if (dataType === 'hours') return `${value} ${value === 1 ? 'hour' : 'hours'}`;
  return unit ? `${value} ${unit}` : String(value);
}

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). A single metric
 * value, presented as a stat card — the Report Viewer's and Dashboard's
 * shared building block. Never computes the value itself; `value` is
 * always whatever `reportingService`/`dashboardService` already returned.
 * `onDrillDown` is optional so a metric with nowhere useful to link never
 * renders as a dead-end click target (see this phase's own "no dead-end
 * dashboard numbers" rule) but also never fakes affordance it doesn't have.
 *
 * SOLIS Final Phase §4.2 (2026-10): renders the shared `.sx-kpi` markup —
 * the caller wraps one or more of these in a `.sx-kpis` strip (see
 * app/(portal)/reports/[reportKey]/page.tsx). The `Card` wrapper is
 * removed: `.sx-kpis`/`.sx-kpi` already supply the strip's own
 * borders/dividers, which would otherwise double up against a bordered
 * card per item.
 */
export function MetricCard({
  displayName,
  description,
  value,
  dataType,
  unit,
  onDrillDown,
}: {
  displayName: string;
  description?: string;
  value: unknown;
  dataType: MetricDataType;
  unit: string;
  onDrillDown?: () => void;
}) {
  const formatted = formatValue(value, dataType, unit);
  const content = (
    <>
      <span className="sx-kpi-label">{displayName}</span>
      <span className="sx-kpi-value">{formatted}</span>
      {description ? <span className="sx-kpi-caption">{description}</span> : null}
    </>
  );

  if (onDrillDown) {
    return (
      <button
        type="button"
        onClick={onDrillDown}
        className="sx-kpi"
        style={{ border: 'none', background: 'none', font: 'inherit', cursor: 'pointer', textAlign: 'left' }}
      >
        {content}
      </button>
    );
  }

  return <div className="sx-kpi">{content}</div>;
}
