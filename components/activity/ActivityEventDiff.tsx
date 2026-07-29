import type { ActivityEvent } from '@/types/activityEvent';
import styles from './ActivityEventDiff.module.css';

function parseJsonValue(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Phase 24 (Case Activity Timeline & Audit Center). The before/after
 * comparison for one ActivityEvent — shared by `CaseActivityTab.tsx`'s
 * expandable rows and the Audit Center's row-click detail view, since both
 * need to render the exact same `previousValue`/`newValue` shape (see
 * ADR-028's minimization rule: changed fields only, never a full entity
 * snapshot, so this walks the union of both objects' keys rather than
 * assuming every key appears in both).
 */
export function ActivityEventDiff({ event }: { event: ActivityEvent }) {
  const previous = parseJsonValue(event.previousValue);
  const next = parseJsonValue(event.newValue);
  if (!previous && !next) return null;

  const fields = Array.from(new Set([...(previous ? Object.keys(previous) : []), ...(next ? Object.keys(next) : [])]));

  return (
    <div className={styles.diff}>
      {fields.map((field) => (
        <div key={field} className={styles.diffRow}>
          <span className={styles.diffField}>{field}</span>
          {previous && field in previous && <span className={styles.diffPrevious}>{String(previous[field])}</span>}
          {previous && field in previous && next && field in next && <span className={styles.diffArrow}>→</span>}
          {next && field in next && <span className={styles.diffNext}>{String(next[field])}</span>}
        </div>
      ))}
    </div>
  );
}
