import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { useOrganization } from '@/hooks/useOrganization';
import { useOrganizationRecord } from '@/hooks/useOrganizationRecord';
import { useUpcomingServices } from '@/hooks/useUpcomingServices';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';
import type { UpcomingServiceSummary } from '@/services/upcomingServicesService';
import styles from './UpcomingServicesPanel.module.css';

/**
 * Upcoming services (Gus Phase 5L, 2026-11): each Viewing / Final Goodbye
 * in the next two weeks — and any recent one not yet released for
 * cremation — with how much of its preparation is done. Read-only; each
 * row opens the case. Only for organizations with service preparation.
 */
const when = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

function state(s: UpcomingServiceSummary): { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' | 'brand' } {
  if (s.status === 'completed') return s.awaitingRelease ? { label: 'Awaiting release', variant: 'brand' } : { label: 'Completed', variant: 'neutral' };
  if (s.overdue > 0) return { label: `${s.overdue} overdue`, variant: 'danger' };
  if (s.ready) return { label: 'Ready', variant: 'success' };
  return { label: `${s.blocking} to do`, variant: 'warning' };
}

export function UpcomingServicesPanel() {
  const { organizationId } = useOrganization();
  const organizationRecord = useOrganizationRecord();
  const enabled = getRegisteredOrganizationProfile(organizationId).features.servicePreparation;
  const query = useUpcomingServices(organizationId, enabled);
  if (!enabled) return null;
  const timeZone = organizationRecord.data?.timezone ?? 'America/New_York';

  return (
    <section className={styles.card} aria-label="Upcoming services" data-testid="upcoming-services">
      <div className={styles.title}>Upcoming services</div>
      {query.isPending && <p className={styles.empty} aria-busy="true">Loading…</p>}
      {query.isError && (
        <p className={styles.empty} role="alert">
          {query.error.message}
        </p>
      )}
      {query.data && query.data.length === 0 && <p className={styles.empty}>No Viewing or Final Goodbye in the next two weeks.</p>}
      {query.data && query.data.length > 0 && (
        <ul className={styles.list}>
          {query.data.map((s) => {
            const badge = state(s);
            return (
              <li key={s.caseId}>
                <Link className={styles.row} href={`/cases/${encodeURIComponent(s.caseId)}`}>
                  <span className={styles.when}>{when(s.startAt, timeZone)}</span>
                  <span className={styles.who}>
                    <strong>{s.decedentName || s.caseNumber}</strong>
                    <span className={styles.meta}>
                      {s.serviceName} · {s.caseNumber} · {s.completed}/{s.total} prepared
                    </span>
                  </span>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
