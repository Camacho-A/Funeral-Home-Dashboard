'use client';

import { use } from 'react';
import { useFamilyCase, useFamilyTimeline } from '@/hooks/useFamilyPortal';
import { FamilyCaseNav } from '@/components/family/FamilyCaseNav';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/format';
import styles from '@/components/family/FamilyCaseSection.module.css';

/**
 * Phase 29 (Family Portal & External Collaboration). The case overview —
 * summary fields from `PortalCaseView` plus the allowlisted activity
 * timeline (`FAMILY_VISIBLE_EVENT_TYPES` only — see
 * `domain/portal/portalActivityView.ts`).
 */
export default function FamilyCaseOverviewPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  const caseQuery = useFamilyCase(caseId);
  const timelineQuery = useFamilyTimeline(caseId);

  if (caseQuery.isPending) return <p className={styles.loading}>Loading case…</p>;
  if (caseQuery.isError) return <p className={styles.errorText}>Couldn&rsquo;t load this case. Please try again.</p>;

  const caseView = caseQuery.data;
  const events = timelineQuery.data?.events ?? [];

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>{caseView.decedentName}</h1>
      <FamilyCaseNav caseId={caseId} />

      <Card className={styles.listCard}>
        <div className={styles.row}>
          <div className={styles.identity}>
            <span className={styles.meta}>Case number</span>
            <span className={styles.title}>{caseView.caseNumber}</span>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.identity}>
            <span className={styles.meta}>Status</span>
            <span className={styles.title}>{caseView.stageLabel}</span>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.identity}>
            <span className={styles.meta}>Date of birth</span>
            <span className={styles.title}>{caseView.dateOfBirth}</span>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.identity}>
            <span className={styles.meta}>Date of passing</span>
            <span className={styles.title}>{caseView.dateOfDeath}</span>
          </div>
        </div>
      </Card>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent Activity</h2>
        {events.length === 0 ? (
          <EmptyState message="No recent activity for this case." />
        ) : (
          <Card className={styles.listCard}>
            {events.map((event) => (
              <div key={event.id} className={styles.row}>
                <div className={styles.identity}>
                  <span className={styles.title}>{event.description}</span>
                  <span className={styles.meta}>{formatTimestamp(event.createdAt)}</span>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
