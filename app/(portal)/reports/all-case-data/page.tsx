'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { EmptyState } from '@/components/ui/EmptyState';
import { TextField } from '@/components/ui/TextField';
import { allCaseDataExportUrl } from '@/lib/reportsClient';

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
 *
 * SOLIS Final Phase §4.3 (2026-10): the description text changes to call
 * out financial columns specifically, since `allCaseDataReportService.ts`'s
 * own `includeFinancial` flag genuinely does gate those columns (confirmed
 * via that service's own `includeFinancial`-conditioned fields) — not a
 * description change made without checking the real behavior it describes.
 */
export default function AllCaseDataReportPage() {
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  if (permissionsQuery.isPending) {
    return (
      <div className="sx-loading" aria-busy="true">
        <span className="sx-skeleton" style={{ width: '90%' }} />
        <span className="sx-skeleton" style={{ width: '70%' }} />
        <span className="sr-only">Loading report…</span>
      </div>
    );
  }

  const permissions = permissionsQuery.data?.permissions ?? [];
  if (!permissions.includes('report.view') || !permissions.includes('report.operational')) {
    return <EmptyState message="You don't have access to this report for this organization." />;
  }
  const canExport = permissions.includes('report.export');

  const filters = { fromDate: fromDate || undefined, toDate: toDate || undefined };

  return (
    <div style={{ maxWidth: 760 }}>
      <Link href="/reports" className="sx-back">
        ← Reports
      </Link>
      <div className="sx-page-header">
        <div>
          <h1 className="sx-page-title">All Case Data</h1>
          <p className="sx-page-desc">
            One row per case with its operational data. Financial columns are included only if you have
            financial-report access.
          </p>
        </div>
      </div>

      <h2 className="sx-section-title" style={{ marginBottom: 16 }}>
        Date range
      </h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <div className="sx-field">
          <span className="sx-label">Created from</span>
          <TextField type="date" className="sx-input" style={{ width: 180 }} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="sx-field">
          <span className="sx-label">Created to</span>
          <TextField type="date" className="sx-input" style={{ width: 180 }} value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>
      <p className="sx-help" style={{ marginTop: 8, marginBottom: 24 }}>
        Filters by case creation date. Leave both blank to export every case.
      </p>

      <h2 className="sx-section-title">Export</h2>
      {canExport ? (
        <div className="sx-export">
          <a href={allCaseDataExportUrl(organizationId, 'csv', filters)} aria-label="Export CSV" style={{ height: 34 }}>
            CSV
          </a>
          <a href={allCaseDataExportUrl(organizationId, 'xlsx', filters)} aria-label="Export Excel" style={{ height: 34 }}>
            Excel
          </a>
          <a href={allCaseDataExportUrl(organizationId, 'pdf', filters)} aria-label="Export PDF" style={{ height: 34 }}>
            PDF
          </a>
        </div>
      ) : (
        <p className="sx-help">You don&rsquo;t have permission to export reports for this organization.</p>
      )}
    </div>
  );
}
