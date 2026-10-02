import { useMemo } from 'react';
import Link from 'next/link';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useOrganizationActivity } from '@/hooks/useActivity';
import { useCases } from '@/hooks/useCases';
import { resolveActivityDisplayDescription, activityActorLabel } from '@/domain/activity/activityDisplay';
import styles from './RecentActivityPanel.module.css';

function timeAgo(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  return new Date(createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). Previously
 * rendered `services/__mocks__/fixtures.ts`'s static `activityFeedFixtures`
 * — decorative content with no connection to real case activity. Now
 * reads real organization activity via `activityService.ts` (the same
 * source `AuditCenterPanel` uses), gated by the same `audit.read`
 * permission — not a new, parallel audit system, and not ungated
 * regardless of role as the static version was.
 *
 * Manors go-live improvement (2026-09): each case-related entry also shows
 * its Case Number, so staff don't have to guess which case an activity
 * line belongs to. Resolved from `useCases()` — the exact same query
 * (`['cases', organizationId, {}]`) the Dashboard page itself already
 * fires for `allCases`/`NeedsAttentionPanel`, so React Query's own
 * identical-key dedup means this never becomes a second network request,
 * and definitely never one request per activity row. `Case.caseNumber` is
 * read directly, never reconstructed from `caseId`/dates/sequence — and
 * since `useCases()` is itself already scoped to the caller's authorized
 * organization (see that hook), a stale/missing/other-org caseId simply
 * fails the Map lookup and renders with no Case Number at all, never a
 * placeholder, never the raw id.
 *
 * Actor-attribution fix (2026-09): each entry's secondary line now leads
 * with the actual employee who performed it (`activityActorLabel`, the
 * same shared resolver `CaseActivityTab` already uses) instead of only a
 * timestamp — `entry.actorDisplayName` is resolved server-side per
 * request from the event's own recorded `actorIdentityId` (see
 * `services/activityService.ts#attachActorDisplayNames`), never from the
 * signed-in viewer, so a historical entry always shows who actually
 * performed it rather than whoever is currently looking at the Dashboard.
 */
export function RecentActivityPanel() {
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const canReadAudit = (permissionsQuery.data?.permissions ?? []).includes('audit.read');
  const activityQuery = useOrganizationActivity(organizationId, {}, canReadAudit);
  const casesQuery = useCases();

  const entries = useMemo(() => (activityQuery.data?.pages ?? []).flatMap((page) => page.events).slice(0, 8), [activityQuery.data]);

  const caseNumberById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of casesQuery.data ?? []) map.set(c.id, c.caseNumber);
    return map;
  }, [casesQuery.data]);

  if (!canReadAudit) return null;

  return (
    <div className={styles.card}>
      <div className={styles.title}>Recent activity</div>
      <div className={styles.list}>
        {entries.length === 0 && <div className={styles.row}>No recent activity.</div>}
        {entries.map((entry) => {
          const caseNumber = entry.caseId ? caseNumberById.get(entry.caseId) : undefined;
          const rowContent = (
            <>
              <div className={styles.rowMain}>
                {caseNumber && <span className={styles.caseNumber}>{caseNumber}</span>}
                <span className={styles.what}>{resolveActivityDisplayDescription(entry)}</span>
              </div>
              <div className={styles.when}>
                {activityActorLabel(entry)} · {timeAgo(entry.createdAt)}
              </div>
            </>
          );
          // Clickable only when caseId resolves to a Case the viewer is
          // actually authorized to see (same `caseNumberById` lookup that
          // already gates showing the Case Number badge, scoped to this
          // organization's own `useCases()` — see that hook). A stale or
          // cross-org caseId that doesn't resolve is not a "valid case
          // destination": it stays a plain, non-interactive row rather than
          // navigating to a fabricated/unauthorized URL.
          if (entry.caseId && caseNumber) {
            return (
              <Link key={entry.id} href={`/cases/${entry.caseId}`} className={`${styles.row} ${styles.rowLink}`}>
                {rowContent}
              </Link>
            );
          }
          return (
            <div key={entry.id} className={styles.row}>
              {rowContent}
            </div>
          );
        })}
      </div>
    </div>
  );
}
