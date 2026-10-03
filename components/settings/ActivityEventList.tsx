'use client';

import { formatTimestamp } from '@/utils/format';
import { ACTIVITY_CATEGORY_LABEL, activityActorLabel, resolveActivityDisplayDescription } from '@/domain/activity/activityDisplay';
import type { ActivityEvent } from '@/types/activityEvent';

/**
 * Phase 24 (Case Activity Timeline & Audit Center). The Audit Center's
 * dense event table.
 *
 * SOLIS Final Phase §6/§8.3 (2026-10): restyled from a Card-wrapped
 * button-row list into a real `table.sx-table.sx-table-stack`, per the
 * design. Three real fixes landed alongside the restyle (all presentation
 * — no event generation/storage/permission changed):
 *  - "Who" now goes through the shared `activityActorLabel` resolver
 *    (actorDisplayName → role catalog → "Unknown") instead of this file's
 *    own degraded inline `actorRoleKey ?? 'Unknown'`, which never
 *    consulted `actorDisplayName` at all.
 *  - "What happened" goes through `resolveActivityDisplayDescription`
 *    (same presentation-only remap RecentActivityPanel/CaseActivityTab
 *    use — e.g. the exact persisted "Case updated (checklistState)" string
 *    displays as "Checklist updated") instead of the raw stored
 *    `description`.
 *  - A new Case column, resolved via the parent's `caseNumberById` map
 *    (same `useCases()` lookup pattern Phase 1's Recent Activity panel
 *    uses) — empty when the event has no caseId or it doesn't resolve.
 * Each row is keyboard-operable (`tabIndex`, Enter) and still calls the
 * same `onSelectEvent` the parent's detail modal already used.
 */
export function ActivityEventList({
  events,
  onSelectEvent,
  caseNumberById,
}: {
  events: ActivityEvent[];
  onSelectEvent: (event: ActivityEvent) => void;
  caseNumberById: Map<string, string>;
}) {
  return (
    <table className="sx-table sx-table-stack">
      <colgroup>
        <col style={{ width: 150 }} />
        <col />
        <col style={{ width: 150 }} />
        <col style={{ width: 140 }} />
        <col style={{ width: 110 }} />
      </colgroup>
      <thead>
        <tr>
          <th>When</th>
          <th>What happened</th>
          <th>Who</th>
          <th>Case</th>
          <th>Category</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => {
          const caseNumber = event.caseId ? caseNumberById.get(event.caseId) : undefined;
          return (
            <tr
              key={event.id}
              data-clickable
              tabIndex={0}
              onClick={() => onSelectEvent(event)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelectEvent(event);
              }}
            >
              <td data-label="When" className="sx-mono">
                {formatTimestamp(event.createdAt)}
              </td>
              <td data-label="What happened" data-primary>
                {resolveActivityDisplayDescription(event)}
                {event.severity !== 'info' && (
                  <span
                    className="sx-tag"
                    style={
                      event.severity === 'critical'
                        ? { background: 'var(--sx-red-bg)', color: 'var(--sx-red)', marginLeft: 6 }
                        : { background: 'var(--sx-amber-bg)', color: 'var(--sx-amber-text)', marginLeft: 6 }
                    }
                  >
                    {event.severity}
                  </span>
                )}
              </td>
              <td data-label="Who">{activityActorLabel(event)}</td>
              <td data-label="Case">
                {event.caseId && caseNumber ? (
                  <a href={`/cases/${event.caseId}`} className="sx-link" onClick={(e) => e.stopPropagation()}>
                    {caseNumber}
                  </a>
                ) : null}
              </td>
              <td data-label="Category" style={{ fontSize: 12.5, color: 'var(--sx-muted)' }}>
                {ACTIVITY_CATEGORY_LABEL[event.category]}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
