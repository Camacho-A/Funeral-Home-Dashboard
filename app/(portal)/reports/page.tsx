'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useReportDefinitions } from '@/hooks/useReports';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import type { ReportCategory, ReportDefinition } from '@/domain/reporting/reportRegistry';
import styles from './page.module.css';

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  operational: 'Operational',
  financial: 'Financial',
  staff: 'Staff',
  documents: 'Documents & Signatures',
};

const CATEGORY_ORDER: ReportCategory[] = ['operational', 'financial', 'staff', 'documents'];

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). Reports Library —
 * replaces the Phase 8 client-computed Reports page. Every report shown
 * here is already permission-filtered server-side (`GET /api/reports`);
 * this page only groups and renders what it received, it never decides
 * what's visible itself.
 */
export default function ReportsPage() {
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const reportsQuery = useReportDefinitions(organizationId);

  const grouped = useMemo(() => {
    const reports = reportsQuery.data ?? [];
    const byCategory = new Map<ReportCategory, ReportDefinition[]>();
    for (const report of reports) {
      const list = byCategory.get(report.category) ?? [];
      list.push(report);
      byCategory.set(report.category, list);
    }
    return byCategory;
  }, [reportsQuery.data]);

  if (permissionsQuery.isPending || reportsQuery.isPending) {
    return <p>Loading reports…</p>;
  }

  const permissions = permissionsQuery.data?.permissions ?? [];
  if (!permissions.includes('report.view')) {
    return <EmptyState message="You don't have access to reports for this organization." />;
  }

  if ((reportsQuery.data ?? []).length === 0) {
    return <EmptyState message="No reports are available to you." />;
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Reports</h1>
      </div>

      {CATEGORY_ORDER.filter((category) => grouped.has(category)).map((category) => (
        <section key={category} className={styles.section}>
          <h2 className={styles.sectionTitle}>{CATEGORY_LABELS[category]}</h2>
          <div className={styles.grid}>
            {grouped.get(category)!.map((report) => (
              <Link key={report.key} href={`/reports/${report.key}`} className={styles.cardLink}>
                <Card variant="bordered" className={styles.reportCard}>
                  <span className={styles.reportName}>{report.displayName}</span>
                  <span className={styles.reportDescription}>{report.description}</span>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
