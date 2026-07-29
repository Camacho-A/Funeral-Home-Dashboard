'use client';

import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatTimestamp } from '@/utils/format';
import { activitySeverityVariant, ACTIVITY_CATEGORY_LABEL } from '@/domain/activity/activityDisplay';
import type { ActivityEvent } from '@/types/activityEvent';
import styles from './ActivityEventList.module.css';

/**
 * Phase 24 (Case Activity Timeline & Audit Center). The Audit Center's
 * dense event table — a `Card`-wrapped row list, matching
 * `TeamMemberList.tsx`'s convention (no `<table>` markup exists anywhere
 * in this codebase's settings area; every list here is a div/grid-based
 * row list). Each row opens `onSelectEvent`'s detail view (owned by the
 * parent panel, same as `TeamMemberList`'s confirm dialog is owned by
 * itself but the invite modal is owned by `TeamManagementPanel`).
 */
export function ActivityEventList({ events, onSelectEvent }: { events: ActivityEvent[]; onSelectEvent: (event: ActivityEvent) => void }) {
  return (
    <Card className={styles.card}>
      <div className={styles.headerRow}>
        <span>When</span>
        <span>Category</span>
        <span>Severity</span>
        <span>Actor</span>
        <span>Description</span>
      </div>
      <div className={styles.list}>
        {events.map((event) => (
          <button key={event.id} type="button" className={styles.row} onClick={() => onSelectEvent(event)}>
            <span className={styles.when}>{formatTimestamp(event.createdAt)}</span>
            <span className={styles.category}>{ACTIVITY_CATEGORY_LABEL[event.category]}</span>
            <Badge variant={activitySeverityVariant(event.severity)}>{event.severity}</Badge>
            <span className={styles.actor}>{event.isSystemGenerated ? 'System' : (event.actorRoleKey ?? 'Unknown')}</span>
            <span className={styles.description}>{event.description}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
