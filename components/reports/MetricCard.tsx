import { Card } from '@/components/ui/Card';
import type { MetricDataType } from '@/domain/reporting/metricRegistry';
import styles from './MetricCard.module.css';

function formatValue(value: unknown, dataType: MetricDataType, unit: string): string {
  if (Array.isArray(value)) return `${value.length} rows`;
  if (typeof value !== 'number') return String(value);
  if (dataType === 'currency') return `$${(value / 100).toFixed(2)}`;
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
      <span className={styles.label}>{displayName}</span>
      <span className={styles.value}>{formatted}</span>
      {description ? <span className={styles.description}>{description}</span> : null}
    </>
  );

  return (
    <Card variant="elevated" className={styles.card}>
      {onDrillDown ? (
        <button type="button" onClick={onDrillDown} className={`${styles.body} ${styles.clickable}`}>
          {content}
        </button>
      ) : (
        <div className={styles.body}>{content}</div>
      )}
    </Card>
  );
}
