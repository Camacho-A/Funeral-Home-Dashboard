import { useMemo } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useOrganizationActivity } from '@/hooks/useActivity';
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
 */
export function RecentActivityPanel() {
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const canReadAudit = (permissionsQuery.data?.permissions ?? []).includes('audit.read');
  const activityQuery = useOrganizationActivity(organizationId, {}, canReadAudit);

  const entries = useMemo(() => (activityQuery.data?.pages ?? []).flatMap((page) => page.events).slice(0, 8), [activityQuery.data]);

  if (!canReadAudit) return null;

  return (
    <div className={styles.card}>
      <div className={styles.title}>Recent activity</div>
      <div className={styles.list}>
        {entries.length === 0 && <div className={styles.row}>No recent activity.</div>}
        {entries.map((entry) => (
          <div key={entry.id} className={styles.row}>
            <div>
              <span className={styles.what}>{entry.description}</span>
            </div>
            <div className={styles.when}>{timeAgo(entry.createdAt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
