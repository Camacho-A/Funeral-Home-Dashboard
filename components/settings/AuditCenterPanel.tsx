'use client';

import { useMemo, useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useOrganizationActivity } from '@/hooks/useActivity';
import { useCases } from '@/hooks/useCases';
import { buildActivityExportUrl, type ActivityFilters } from '@/lib/activityClient';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { formatTimestamp } from '@/utils/format';
import { ACTIVITY_CATEGORY_LABEL, activityActorLabel, resolveActivityDisplayDescription } from '@/domain/activity/activityDisplay';
import { ActivityEventDiff } from '@/components/activity/ActivityEventDiff';
import type { ActivityEvent, ActivityEventCategory, ActivitySeverity } from '@/types/activityEvent';
import { ActivityEventList } from './ActivityEventList';
import styles from './AuditCenterPanel.module.css';

const CATEGORY_OPTIONS = Object.entries(ACTIVITY_CATEGORY_LABEL) as [ActivityEventCategory, string][];
const SEVERITY_OPTIONS: ActivitySeverity[] = ['info', 'warning', 'critical'];

/** SOLIS Final Phase §6 — the only "active filter" treatment a non-empty
    filter control gets; no new clear-all. */
const ACTIVE_FILTER_STYLE = { borderColor: 'var(--sx-navy)', background: 'oklch(0.97 0.012 255)' };

/**
 * Phase 24 (Case Activity Timeline & Audit Center). "Settings > Audit" —
 * the orchestration layer, matching `TeamManagementPanel.tsx`'s pattern:
 * this owns the filter state, the selected-event-for-detail state, and
 * gates its own rendering/actions on `audit.read`/`audit.export` via the
 * existing `useMyPermissions` (no new permission hook — see ADR-028 §9).
 *
 * The free-text search commits on submit rather than on every keystroke,
 * since each committed filter value changes the TanStack Query key and
 * triggers a fresh keyset-paginated fetch — committing on every keystroke
 * would refetch on every character typed.
 *
 * SOLIS Final Phase §6 (2026-10): this now also renders the page's own
 * `.sx-page-header` (title/description/Export CSV action) — moved here,
 * rather than in the `/settings/audit` page wrapper, since Export CSV's
 * `canExportAudit`/`filters` already live in this component and no other
 * settings sub-page renders a back link (so `.sx-back` is correctly
 * omitted per the spec's own conditional). The page wrapper now renders
 * only `<AuditCenterPanel />`.
 */
export function AuditCenterPanel() {
  const { organizationId } = useOrganization();
  const myPermissionsQuery = useMyPermissions(organizationId);
  const casesQuery = useCases();

  const [category, setCategory] = useState<ActivityEventCategory | ''>('');
  const [severity, setSeverity] = useState<ActivitySeverity | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [committedQuery, setCommittedQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<ActivityEvent | null>(null);

  const filters: ActivityFilters = {
    ...(category && { category }),
    ...(severity && { severity }),
    ...(from && { from: new Date(from).toISOString() }),
    ...(to && { to: new Date(`${to}T23:59:59.999`).toISOString() }),
    ...(committedQuery && { q: committedQuery }),
  };

  const permissions = myPermissionsQuery.data?.permissions ?? [];
  const canReadAudit = permissions.includes('audit.read');
  const canExportAudit = permissions.includes('audit.export');

  const activityQuery = useOrganizationActivity(organizationId, filters, canReadAudit);

  // SOLIS Final Phase §6 — same useCases() lookup pattern Phase 1's
  // Recent Activity panel uses, for the new Case column/detail field.
  const caseNumberById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of casesQuery.data ?? []) map.set(c.id, c.caseNumber);
    return map;
  }, [casesQuery.data]);

  if (myPermissionsQuery.isPending) {
    return <p>Loading audit center…</p>;
  }

  if (!canReadAudit) {
    return <EmptyState message="You don't have access to the audit log for this organization." />;
  }

  const events = activityQuery.data?.pages.flatMap((page) => page.events) ?? [];

  return (
    <div>
      <div className="sx-page-header">
        <div>
          <h1 className="sx-page-title">Audit Center</h1>
          <p className="sx-page-desc">Every recorded action across your organization — what happened, who, when, and on which case.</p>
        </div>
        <div className="sx-page-actions">
          <button
            type="button"
            className="sx-btn sx-btn-secondary"
            disabled={!canExportAudit}
            title={canExportAudit ? undefined : "You don't have permission to export the audit log."}
            onClick={() => {
              window.location.href = buildActivityExportUrl(organizationId, filters);
            }}
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="sx-filterbar">
        <label className="sx-filter">
          <span className="sx-filter-label">Category</span>
          <SelectField
            className="sx-select"
            style={category ? ACTIVE_FILTER_STYLE : undefined}
            value={category}
            onChange={(e) => setCategory(e.target.value as ActivityEventCategory | '')}
          >
            <option value="">All categories</option>
            {CATEGORY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="sx-filter">
          <span className="sx-filter-label">Severity</span>
          <SelectField
            className="sx-select"
            style={severity ? ACTIVE_FILTER_STYLE : undefined}
            value={severity}
            onChange={(e) => setSeverity(e.target.value as ActivitySeverity | '')}
          >
            <option value="">All severities</option>
            {SEVERITY_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="sx-filter">
          <span className="sx-filter-label">From</span>
          <TextField className="sx-input" style={from ? ACTIVE_FILTER_STYLE : undefined} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>

        <label className="sx-filter">
          <span className="sx-filter-label">To</span>
          <TextField className="sx-input" style={to ? ACTIVE_FILTER_STYLE : undefined} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>

        <form
          style={{ display: 'flex', gap: 6, marginLeft: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            setCommittedQuery(queryInput);
          }}
        >
          <TextField
            className="sx-input"
            style={{ width: 240 }}
            aria-label="Search description"
            placeholder="Search description…"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
          />
          <button type="submit" className="sx-btn sx-btn-secondary sx-btn-sm" style={{ height: 32 }}>
            Search
          </button>
        </form>
      </div>

      {activityQuery.isPending ? (
        <div className="sx-loading" aria-busy="true">
          <span className="sx-skeleton" style={{ width: '90%' }} />
          <span className="sx-skeleton" style={{ width: '70%' }} />
          <span className="sx-skeleton" style={{ width: '80%' }} />
          <span className="sr-only">Loading activity…</span>
        </div>
      ) : events.length === 0 ? (
        <EmptyState message="No activity matches these filters." helperText="Try a wider date range or clear the category." />
      ) : (
        <>
          <ActivityEventList events={events} onSelectEvent={setSelectedEvent} caseNumberById={caseNumberById} />
          <div className="sx-table-foot">
            <span>Showing {events.length} events · click a row for full detail</span>
            {activityQuery.hasNextPage && (
              <button
                type="button"
                className="sx-btn sx-btn-secondary"
                onClick={() => activityQuery.fetchNextPage()}
                disabled={activityQuery.isFetchingNextPage}
              >
                {activityQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </>
      )}

      {selectedEvent && (
        <Modal open onClose={() => setSelectedEvent(null)} title={resolveActivityDisplayDescription(selectedEvent)}>
          <div className={styles.detail}>
            <h2 className={styles.detailTitle}>{resolveActivityDisplayDescription(selectedEvent)}</h2>
            <dl className={styles.detailFields}>
              <dt>When</dt>
              <dd>{formatTimestamp(selectedEvent.createdAt)}</dd>
              <dt>Category</dt>
              <dd>{ACTIVITY_CATEGORY_LABEL[selectedEvent.category]}</dd>
              <dt>Event type</dt>
              <dd>{selectedEvent.eventType}</dd>
              <dt>Severity</dt>
              <dd>{selectedEvent.severity}</dd>
              <dt>Actor</dt>
              <dd>{activityActorLabel(selectedEvent)}</dd>
              {selectedEvent.caseId && (
                <>
                  <dt>Case</dt>
                  <dd>{caseNumberById.get(selectedEvent.caseId) ?? selectedEvent.caseId}</dd>
                </>
              )}
            </dl>
            <ActivityEventDiff event={selectedEvent} />
            <div className={styles.detailActions}>
              <button type="button" className="sx-btn sx-btn-secondary" onClick={() => setSelectedEvent(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
