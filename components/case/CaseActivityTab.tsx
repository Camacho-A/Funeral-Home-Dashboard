'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useCaseActivity } from '@/hooks/useActivity';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/format';
import { activitySeverityVariant } from '@/domain/activity/activityDisplay';
import { ActivityEventDiff } from '@/components/activity/ActivityEventDiff';
import styles from './CaseActivityTab.module.css';

/**
 * Phase 24 (Case Activity Timeline & Audit Center). The Case Detail
 * page's "Activity" tab — a real, persisted timeline backed by
 * `GET /api/cases/[caseId]/activity`, standing alongside (not replacing)
 * the Overview tab's existing `ActivityLogCard`, which stays exactly as
 * it was per ADR-028 §8's rollback-safety decision.
 */
export function CaseActivityTab({ caseId }: { caseId: string }) {
  const { organizationId } = useOrganization();
  const query = useCaseActivity(caseId, organizationId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (query.isPending) return <p className={styles.loading}>Loading activity…</p>;
  if (query.isError) return <p className={styles.errorText}>Couldn&rsquo;t load activity. Please try again.</p>;

  const events = query.data?.pages.flatMap((page) => page.events) ?? [];

  if (events.length === 0) {
    return <EmptyState message="No activity recorded for this case yet." />;
  }

  return (
    <div className={styles.card}>
      <div className={styles.list}>
        {events.map((event) => {
          const hasDetail = event.previousValue !== null || event.newValue !== null;
          const isExpanded = expandedId === event.id;
          const actorLabel = event.isSystemGenerated ? 'System' : (event.actorRoleKey ?? 'Unknown');

          return (
            <div key={event.id} className={styles.entry}>
              <div className={styles.dot} />
              <div className={styles.body}>
                {hasDetail ? (
                  <button type="button" className={styles.descriptionRow} onClick={() => setExpandedId(isExpanded ? null : event.id)}>
                    <span className={styles.description}>{event.description}</span>
                    {event.severity !== 'info' && <Badge variant={activitySeverityVariant(event.severity)}>{event.severity}</Badge>}
                  </button>
                ) : (
                  <div className={styles.descriptionRow}>
                    <span className={styles.description}>{event.description}</span>
                    {event.severity !== 'info' && <Badge variant={activitySeverityVariant(event.severity)}>{event.severity}</Badge>}
                  </div>
                )}
                <div className={styles.when}>
                  {actorLabel} · {formatTimestamp(event.createdAt)}
                </div>
                {isExpanded && <ActivityEventDiff event={event} />}
              </div>
            </div>
          );
        })}
      </div>

      {query.hasNextPage && (
        <Button variant="secondary" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
