'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useCaseActivity } from '@/hooks/useActivity';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/format';
import { printTextLog } from '@/utils/print';
import {
  activityActorLabel,
  resolveActivityDisplayDescription,
  resolveCaseCreatedDisplay,
  staffNameForCreation,
} from '@/domain/activity/activityDisplay';
import { ActivityEventDiff } from '@/components/activity/ActivityEventDiff';
import type { ActivityEvent, ActivityEventCategory } from '@/types/activityEvent';

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
 *
 * SOLIS Final Phase §8.3 (2026-10): day-grouped timeline, presentation
 * only — `events` passed to `printTextLog` stays the flat, un-grouped
 * array (see this file's own test "the exact array reference passed to
 * printTextLog... never a separately-built... shape"), grouping only
 * happens in render. `resolveActivityDisplayDescription` (shared with
 * RecentActivityPanel/AuditCenterPanel/ActivityEventList — one formatter,
 * not a per-surface duplicate) now maps every curated "Case updated
 * (<field>)" combination and safely falls back to generic "Case updated"
 * for anything uncurated, used both on screen and in the printed row.
 * Glyphs are keyed on the real `ActivityEventCategory` union values
 * (`cases`/`payments`/`documents`/`workflow`/`scheduling`/...), not the
 * spec's singular placeholder names (`case`/`payment`/`document`) — this
 * codebase's categories are plural; unmapped categories fall back to •.
 */
const CATEGORY_GLYPH: Partial<Record<ActivityEventCategory, string>> = {
  workflow: '✓',
  payments: '$',
  financial: '$',
  cases: '•',
  scheduling: '◷',
  authentication: '!',
};

function glyphFor(event: ActivityEvent): string {
  if (event.category === 'documents') {
    const type = event.eventType.toLowerCase();
    if (type.includes('download')) return '↓';
    if (type.includes('upload')) return '↑';
    return '▤';
  }
  return CATEGORY_GLYPH[event.category] ?? '•';
}

function dayLabel(createdAt: string): string {
  const date = new Date(createdAt);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (diffDays === 0) return `Today · ${monthDay}`;
  if (diffDays === 1) return `Yesterday · ${monthDay}`;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function CaseActivityTab({ caseId, caseName, caseNumber }: { caseId: string; caseName: string; caseNumber: string }) {
  const { organizationId } = useOrganization();
  const query = useCaseActivity(caseId, organizationId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (query.isPending) {
    return (
      <div className="sx-loading" aria-busy="true">
        <span className="sx-skeleton" style={{ width: '90%' }} />
        <span className="sx-skeleton" style={{ width: '70%' }} />
        <span className="sx-skeleton" style={{ width: '80%' }} />
        <span className="sr-only">Loading activity…</span>
      </div>
    );
  }
  if (query.isError) return <div className="sx-error-state" role="alert">Couldn&rsquo;t load activity. Please try again.</div>;

  const events = query.data?.pages.flatMap((page) => page.events) ?? [];

  if (events.length === 0) {
    return <EmptyState message="No activity recorded for this case yet." helperText="Changes, documents and payments will appear here as they happen." />;
  }

  function handlePrint() {
    printTextLog('Case Activity', caseName, caseNumber, events, (event: ActivityEvent) => {
      const created = resolveCaseCreatedDisplay(
        event,
        staffNameForCreation(event),
      );
      const what = created?.primary ?? resolveActivityDisplayDescription(event);
      const who = created?.secondary ?? activityActorLabel(event);
      return `<div style="margin-bottom:12px"><div>${what}</div><div style="font-size:12px;color:#888">${who} · ${formatTimestamp(event.createdAt)}</div></div>`;
    });
  }

  // Group the already-loaded events, keeping their order, by local
  // calendar day — never filtering or merging any event.
  const groups: { label: string; events: ActivityEvent[] }[] = [];
  for (const event of events) {
    const label = dayLabel(event.createdAt);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.label === label) lastGroup.events.push(event);
    else groups.push({ label, events: [event] });
  }

  return (
    <div className="sx-tl">
      <div className="sx-tl-toolbar">
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Case history</h2>
          <p className="sx-page-desc" style={{ marginTop: 2 }}>
            Every recorded change to this case, newest first.
          </p>
        </div>
        <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={handlePrint}>
          Print
        </button>
      </div>

      {groups.map((group) => (
        <div key={group.label}>
          <div className="sx-tl-day">{group.label}</div>
          <ol className="sx-tl-list">
            {group.events.map((event) => {
              const hasDetail = event.previousValue !== null || event.newValue !== null;
              const isExpanded = expandedId === event.id;
              // Creation-source attribution (2026-10) — the same shared
              // resolver the Dashboard feed uses, so the wording is
              // identical across every activity surface.
              const createdDisplay = resolveCaseCreatedDisplay(
                event,
                staffNameForCreation(event),
              );
              const label = createdDisplay?.primary ?? resolveActivityDisplayDescription(event);

              const descriptionContent = (
                <>
                  {label}
                  {event.severity !== 'info' && (
                    <span
                      className="sx-tag"
                      style={
                        event.severity === 'critical'
                          ? { background: 'var(--sx-red-bg)', color: 'var(--sx-red)' }
                          : { background: 'var(--sx-amber-bg)', color: 'var(--sx-amber-text)' }
                      }
                    >
                      {event.severity}
                    </span>
                  )}
                  {hasDetail && (
                    <span aria-hidden="true" style={{ fontSize: 11, color: 'var(--sx-faint)' }}>
                      {isExpanded ? '▴' : '▾'}
                    </span>
                  )}
                </>
              );

              return (
                <li key={event.id} className="sx-tl-item" data-severity={event.severity}>
                  <span className="sx-tl-glyph" aria-hidden="true">
                    {glyphFor(event)}
                  </span>
                  <div>
                    {hasDetail ? (
                      <button type="button" className="sx-tl-desc" aria-expanded={isExpanded} onClick={() => setExpandedId(isExpanded ? null : event.id)}>
                        {descriptionContent}
                      </button>
                    ) : (
                      <div className="sx-tl-desc">{descriptionContent}</div>
                    )}
                    <div className="sx-tl-actor">{createdDisplay?.secondary ?? activityActorLabel(event)}</div>
                    {isExpanded && (
                      <div className="sx-tl-diff">
                        <ActivityEventDiff event={event} />
                      </div>
                    )}
                  </div>
                  <span className="sx-tl-time">{new Date(event.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}

      {query.hasNextPage && (
        <button type="button" className="sx-btn sx-btn-secondary" style={{ marginTop: 16 }} onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
