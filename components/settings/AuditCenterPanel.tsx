'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useOrganizationActivity } from '@/hooks/useActivity';
import { buildActivityExportUrl, type ActivityFilters } from '@/lib/activityClient';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { formatTimestamp } from '@/utils/format';
import { ACTIVITY_CATEGORY_LABEL } from '@/domain/activity/activityDisplay';
import { ActivityEventDiff } from '@/components/activity/ActivityEventDiff';
import type { ActivityEvent, ActivityEventCategory, ActivitySeverity } from '@/types/activityEvent';
import { ActivityEventList } from './ActivityEventList';
import styles from './AuditCenterPanel.module.css';

const CATEGORY_OPTIONS = Object.entries(ACTIVITY_CATEGORY_LABEL) as [ActivityEventCategory, string][];
const SEVERITY_OPTIONS: ActivitySeverity[] = ['info', 'warning', 'critical'];

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
 */
export function AuditCenterPanel() {
  const { organizationId } = useOrganization();
  const myPermissionsQuery = useMyPermissions(organizationId);

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

  if (myPermissionsQuery.isPending) {
    return <p>Loading audit center…</p>;
  }

  if (!canReadAudit) {
    return <EmptyState message="You don't have access to the audit log for this organization." />;
  }

  const events = activityQuery.data?.pages.flatMap((page) => page.events) ?? [];

  return (
    <div>
      <div className={styles.filterBar}>
        <SelectField aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as ActivityEventCategory | '')}>
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>

        <SelectField aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as ActivitySeverity | '')}>
          <option value="">All severities</option>
          {SEVERITY_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </SelectField>

        <TextField aria-label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField aria-label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />

        <form
          className={styles.searchForm}
          onSubmit={(e) => {
            e.preventDefault();
            setCommittedQuery(queryInput);
          }}
        >
          <TextField aria-label="Search description" placeholder="Search description…" value={queryInput} onChange={(e) => setQueryInput(e.target.value)} />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        <Button
          variant="secondary"
          disabled={!canExportAudit}
          title={canExportAudit ? undefined : "You don't have permission to export the audit log."}
          onClick={() => {
            window.location.href = buildActivityExportUrl(organizationId, filters);
          }}
        >
          Export CSV
        </Button>
      </div>

      {activityQuery.isPending ? (
        <p>Loading activity…</p>
      ) : events.length === 0 ? (
        <EmptyState message="No activity matches these filters." />
      ) : (
        <>
          <ActivityEventList events={events} onSelectEvent={setSelectedEvent} />

          {activityQuery.hasNextPage && (
            <div className={styles.loadMore}>
              <Button variant="secondary" onClick={() => activityQuery.fetchNextPage()} disabled={activityQuery.isFetchingNextPage}>
                {activityQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}

      {selectedEvent && (
        <Modal open onClose={() => setSelectedEvent(null)} title={selectedEvent.description}>
          <div className={styles.detail}>
            <h2 className={styles.detailTitle}>{selectedEvent.description}</h2>
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
              <dd>{selectedEvent.isSystemGenerated ? 'System' : (selectedEvent.actorRoleKey ?? 'Unknown')}</dd>
              {selectedEvent.caseId && (
                <>
                  <dt>Case</dt>
                  <dd>{selectedEvent.caseId}</dd>
                </>
              )}
            </dl>
            <ActivityEventDiff event={selectedEvent} />
            <div className={styles.detailActions}>
              <Button variant="secondary" onClick={() => setSelectedEvent(null)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
