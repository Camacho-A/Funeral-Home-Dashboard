'use client';

import { useFamilyCases } from '@/hooks/useFamilyPortal';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './page.module.css';

/**
 * Phase 29 (Family Portal & External Collaboration). Every case this
 * session's `PortalUser` currently has *active* access to — never
 * org-wide, per `GET /api/family/cases`'s own scoping.
 */
export default function FamilyDashboardPage() {
  const casesQuery = useFamilyCases();

  if (casesQuery.isPending) return <p className={styles.loading}>Loading your cases…</p>;
  if (casesQuery.isError) return <p className={styles.errorText}>Couldn&rsquo;t load your cases. Please try again.</p>;

  const cases = casesQuery.data ?? [];

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Your Cases</h1>
      {cases.length === 0 ? (
        <EmptyState message="You don't have access to any cases yet." />
      ) : (
        <div className={styles.list}>
          {cases.map((caseView) => (
            <a key={caseView.id} href={`/family/cases/${caseView.id}`} className={styles.cardLink}>
              <Card className={styles.card}>
                <span className={styles.decedentName}>{caseView.decedentName}</span>
                <span className={styles.caseNumber}>{caseView.caseNumber}</span>
                <span className={styles.stage}>{caseView.stageLabel}</span>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
