'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useReportDefinitions } from '@/hooks/useReports';
import { EmptyState } from '@/components/ui/EmptyState';
import type { ReportCategory, ReportDefinition } from '@/domain/reporting/reportRegistry';
import styles from './page.module.css';

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  operational: 'Operational',
  financial: 'Financial',
  staff: 'Staff',
  documents: 'Documents & Signatures',
  commerce: 'Merchandise & Inventory',
  procurement: 'Procurement & Accounts Payable',
};

const CATEGORY_ORDER: ReportCategory[] = ['operational', 'financial', 'staff', 'documents', 'commerce'];

// SOLIS Final Phase §4.1 — directory-row glyph per category.
const CATEGORY_GLYPH: Record<ReportCategory, string> = {
  operational: '◷',
  financial: '$',
  staff: '◉',
  documents: '▤',
  commerce: '▣',
  procurement: '⇄',
};

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). Reports Library —
 * replaces the Phase 8 client-computed Reports page. Every report shown
 * here is already permission-filtered server-side (`GET /api/reports`);
 * this page only groups and renders what it received, it never decides
 * what's visible itself.
 *
 * SOLIS Final Phase §4.1 (2026-10): presentation only — a directory list
 * (`.sx-dir`/`.sx-dir-row`) replacing the prior `Card`-per-report grid.
 * Same `CATEGORY_ORDER`/`CATEGORY_LABELS`, same server-filtered `reports`
 * list, same hrefs/permission gates.
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
    return (
      <div className="sx-loading" aria-busy="true">
        <span className="sx-skeleton" style={{ width: '90%' }} />
        <span className="sx-skeleton" style={{ width: '70%' }} />
        <span className="sx-skeleton" style={{ width: '80%' }} />
        <span className="sr-only">Loading reports…</span>
      </div>
    );
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
      <div className="sx-page-header">
        <div>
          <h1 className="sx-page-title">Reports</h1>
          <p className="sx-page-desc">Operational, financial and staff reporting for your organization.</p>
        </div>
      </div>

      {permissions.includes('report.operational') && (
        <Link href="/reports/all-case-data" className="sx-feature">
          <span className="sx-dir-icon" aria-hidden="true">
            ⇩
          </span>
          <span>
            <span className="sx-feature-name">All Case Data</span>
            <span className="sx-feature-desc">Export every case&rsquo;s operational data — CSV, Excel, or PDF.</span>
          </span>
          <span className="sx-btn sx-btn-secondary" aria-hidden="true">
            Open
          </span>
        </Link>
      )}

      {CATEGORY_ORDER.filter((category) => grouped.has(category)).map((category) => {
        const reports = grouped.get(category)!;
        return (
          <section key={category} className={styles.section}>
            <h2 className="sx-section-title">
              {CATEGORY_LABELS[category]}
              <span className="sx-section-meta">{reports.length} reports</span>
            </h2>
            <div className="sx-dir" style={{ marginBottom: 0 }}>
              {reports.map((report) => (
                <Link key={report.key} href={`/reports/${report.key}`} className="sx-dir-row">
                  <span className="sx-dir-icon" aria-hidden="true">
                    {CATEGORY_GLYPH[category]}
                  </span>
                  <span>
                    <span className="sx-dir-name">{report.displayName}</span>
                    <span className="sx-dir-desc">{report.description}</span>
                  </span>
                  <span className="sx-dir-arrow" aria-hidden="true">
                    ›
                  </span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
