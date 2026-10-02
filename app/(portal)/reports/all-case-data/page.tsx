'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { EmptyState } from '@/components/ui/EmptyState';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { allCaseDataExportUrl } from '@/lib/reportsClient';
import styles from './page.module.css';

/**
 * Manors cleanup phase (Task #8). "All Case Data" doesn't fit the generic
 * metric-registry Report Viewer (`app/(portal)/reports/[reportKey]/page.tsx`)
 * — it's a row-per-case export, not a metrics/financial-report shape — so
 * it gets its own small page, following the same header/back-link/export
 * conventions that viewer already established. Gated on the same
 * `report.view` + `report.operational` pair the export route itself
 * re-checks server-side (this page's own gate is a UI convenience only;
 * the route is the real enforcement).
 *
 * Date filter applies to case CREATION date — see
 * `services/allCaseDataReportService.ts#DATE_FILTER_FIELD`'s own comment
 * for why — labeled explicitly below so the range's meaning is never
 * ambiguous to the staff member using it.
 */
export default function AllCaseDataReportPage() {
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  if (permissionsQuery.isPending) {
    return <p>Loading report…</p>;
  }

  const permissions = permissionsQuery.data?.permissions ?? [];
  if (!permissions.includes('report.view') || !permissions.includes('report.operational')) {
    return <EmptyState message="You don't have access to this report for this organization." />;
  }
  const canExport = permissions.includes('report.export');

  const filters = { fromDate: fromDate || undefined, toDate: toDate || undefined };

  return (
    <div>
      <div className={styles.header}>
        <div>
          <Link href="/reports" className={styles.backLink}>
            ← Reports
          </Link>
          <h1 className={styles.title}>All Case Data</h1>
          <p className={styles.description}>
            Export all case-level operational data for this organization — one row per case.
          </p>
        </div>
      </div>

      <Card className={styles.filterCard}>
        <div className={styles.filterRow}>
          <label className={styles.filterField}>
            Start Date
            <TextField type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className={styles.filterField}>
            End Date
            <TextField type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
        </div>
        <p className={styles.filterHint}>Filters by case creation date. Leave both blank to export every case.</p>

        {canExport ? (
          <div className={styles.exportRow}>
            <a href={allCaseDataExportUrl(organizationId, 'csv', filters)}>
              <Button variant="secondary">Export CSV</Button>
            </a>
            <a href={allCaseDataExportUrl(organizationId, 'xlsx', filters)}>
              <Button variant="secondary">Export Excel</Button>
            </a>
            <a href={allCaseDataExportUrl(organizationId, 'pdf', filters)}>
              <Button variant="secondary">Export PDF</Button>
            </a>
          </div>
        ) : (
          <p className={styles.filterHint}>You don&rsquo;t have permission to export reports for this organization.</p>
        )}
      </Card>
    </div>
  );
}
