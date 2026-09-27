'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useCaseActivity } from '@/hooks/useActivity';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/format';
import { printTextLog } from '@/utils/print';
import { activitySeverityVariant, activityActorLabel } from '@/domain/activity/activityDisplay';
import { ActivityEventDiff } from '@/components/activity/ActivityEventDiff';
import type { ActivityEvent } from '@/types/activityEvent';
import styles from './CaseActivityTab.module.css';

/**
 * Phase 24 (Case Activity Timeline & Audit Center). The Case Detail
 * page's "Activity" tab — a real, persisted timeline backed by
 * `GET /api/cases/[caseId]/activity`.
 *
 * Item #2 correction (2026-09): the Overview tab's old `ActivityLogCard`
 * (checklist-derived, zero real persistence) has been removed — this tab
 * is now the *only* Activity surface, and its own "Print" action (added
 * here) is what replaces ActivityLogCard's Print button, per that item's
 * explicit "add Print option to the tabs instead". Prints exactly the
 * persisted `ActivityEvent` rows currently loaded/visible in this list —
 * never the old buildTimeline/checklist-derived data — using the same
 * `activityActorLabel()` (35e4c1c) every row already renders with, so a
 * system event prints "System" and a human event prints its friendly role
 * label, never a raw `officeStaff` key.
 */
export function CaseActivityTab({ caseId, caseName, caseNumber }: { caseId: string; caseName: string; caseNumber: string }) {
  const { organizationId } = useOrganization();
  const query = useCaseActivity(caseId, organizationId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (query.isPending) return <p className={styles.loading}>Loading activity…</p>;
  if (query.isError) return <p className={styles.errorText}>Couldn&rsquo;t load activity. Please try again.</p>;

  const events = query.data?.pages.flatMap((page) => page.events) ?? [];

  if (events.length === 0) {
    return <EmptyState message="No activity recorded for this case yet." />;
  }

  function handlePrint() {
    printTextLog('Case Activity', caseName, caseNumber, events, (event: ActivityEvent) => {
      return `<div style="margin-bottom:12px"><div>${event.description}</div><div style="font-size:12px;color:#888">${activityActorLabel(event)} · ${formatTimestamp(event.createdAt)}</div></div>`;
    });
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <Button variant="secondary" onClick={handlePrint}>
          Print
        </Button>
      </div>
      <div className={styles.list}>
        {events.map((event) => {
          const hasDetail = event.previousValue !== null || event.newValue !== null;
          const isExpanded = expandedId === event.id;
          const actorLabel = activityActorLabel(event);

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
