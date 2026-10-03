'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useStaff } from '@/hooks/useStaff';
import { useReportDefinitions, useReportRun } from '@/hooks/useReports';
import { exportReportCsvUrl } from '@/lib/reportsClient';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterBar, type ReportFilterValues } from '@/components/reports/FilterBar';
import { MetricCard } from '@/components/reports/MetricCard';
import { DataTable, type DataTableColumn } from '@/components/reports/DataTable';
import { BarChart } from '@/components/charts/BarChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { getMetricDefinition } from '@/domain/reporting/metricRegistry';
import styles from './page.module.css';

type FinancialLine = { accountNumber: string; accountName: string; amount: number };
type FinancialLineWithSection = FinancialLine & { section: string };

// SOLIS Final Phase §0.5 — display-only currency formatting, matching the
// Intl.NumberFormat convention every other currency display in this phase
// now uses. The underlying report values are unchanged.
const CURRENCY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
function formatReportCents(cents: number): string {
  return CURRENCY.format(cents / 100);
}

const FINANCIAL_LINE_COLUMNS: DataTableColumn<FinancialLine>[] = [
  { header: 'Account #', value: (r) => r.accountNumber },
  { header: 'Account', value: (r) => r.accountName },
  { header: 'Amount', value: (r) => formatReportCents(r.amount), numeric: true },
];
const FINANCIAL_SECTION_COLUMNS: DataTableColumn<FinancialLineWithSection>[] = [
  { header: 'Section', value: (r) => r.section },
  ...FINANCIAL_LINE_COLUMNS,
];

function renderFinancialData(financialReportKey: string, data: unknown) {
  const body = data as Record<string, unknown>;
  switch (financialReportKey) {
    case 'trialBalance': {
      const rows = body.rows as Array<{ accountNumber: string; accountName: string; accountType: string; debitTotal: number; creditTotal: number }>;
      return (
        <DataTable
          rows={rows}
          columns={[
            { header: 'Account #', value: (r) => r.accountNumber },
            { header: 'Account', value: (r) => r.accountName },
            { header: 'Type', value: (r) => r.accountType },
            { header: 'Debit', value: (r) => formatReportCents(r.debitTotal), numeric: true },
            { header: 'Credit', value: (r) => formatReportCents(r.creditTotal), numeric: true },
          ]}
        />
      );
    }
    case 'balanceSheet': {
      const rows: FinancialLineWithSection[] = [
        ...(body.assets as FinancialLine[]).map((l) => ({ ...l, section: 'Assets' })),
        ...(body.liabilities as FinancialLine[]).map((l) => ({ ...l, section: 'Liabilities' })),
        ...(body.equity as FinancialLine[]).map((l) => ({ ...l, section: 'Equity' })),
      ];
      return <DataTable rows={rows} columns={FINANCIAL_SECTION_COLUMNS} />;
    }
    case 'profitAndLoss': {
      const rows: FinancialLineWithSection[] = [
        ...(body.revenue as FinancialLine[]).map((l) => ({ ...l, section: 'Revenue' })),
        ...(body.expenses as FinancialLine[]).map((l) => ({ ...l, section: 'Expenses' })),
      ];
      return <DataTable rows={rows} columns={FINANCIAL_SECTION_COLUMNS} />;
    }
    case 'arAging': {
      const rows = body.rows as Array<{ caseId: string; balanceDue: number; ageDays: number; bucket: string }>;
      return (
        <DataTable
          rows={rows}
          columns={[
            { header: 'Case', value: (r) => r.caseId },
            { header: 'Balance Due', value: (r) => formatReportCents(r.balanceDue), numeric: true },
            { header: 'Age (days)', value: (r) => String(r.ageDays), numeric: true },
            { header: 'Bucket', value: (r) => r.bucket },
          ]}
        />
      );
    }
    case 'transactionRegister': {
      const rows = body as unknown as Array<{ entryDate: string; entryNumber: string; sourceType: string; memo: string; totalAmount: number }>;
      return (
        <DataTable
          rows={rows}
          columns={[
            { header: 'Date', value: (r) => r.entryDate.slice(0, 10) },
            { header: 'Entry #', value: (r) => r.entryNumber },
            { header: 'Source', value: (r) => r.sourceType },
            { header: 'Memo', value: (r) => r.memo },
            { header: 'Amount', value: (r) => formatReportCents(r.totalAmount), numeric: true },
          ]}
        />
      );
    }
    case 'generalLedgerDetail': {
      const rows = (body.rows as Array<{ entryDate: string; entryNumber: string; memo: string; direction: string; amount: number }>) ?? [];
      return (
        <DataTable
          rows={rows}
          columns={[
            { header: 'Date', value: (r) => r.entryDate.slice(0, 10) },
            { header: 'Entry #', value: (r) => r.entryNumber },
            { header: 'Memo', value: (r) => r.memo },
            { header: 'Direction', value: (r) => r.direction },
            { header: 'Amount', value: (r) => formatReportCents(r.amount), numeric: true },
          ]}
        />
      );
    }
    default:
      return null;
  }
}

function renderMetricValue(metricKey: string, value: unknown, dataType: string, unit: string, displayName: string) {
  if (!Array.isArray(value)) {
    return <MetricCard displayName={displayName} value={value} dataType={dataType as never} unit={unit} />;
  }

  if (metricKey === 'cases.stage.count') {
    const rows = value as Array<{ stage: string; count: number }>;
    return <BarChart rows={rows.map((r) => ({ label: r.stage, value: r.count }))} title={displayName} />;
  }
  if (metricKey === 'cases.veteran_status') {
    const rows = value as Array<{ status: 'complete' | 'in_progress' }>;
    const complete = rows.filter((r) => r.status === 'complete').length;
    const inProgress = rows.length - complete;
    return (
      <DonutChart
        title={displayName}
        slices={[
          { label: 'Complete', value: complete, variant: 'success' },
          { label: 'In progress', value: inProgress, variant: 'brand' },
        ]}
      />
    );
  }

  const rows = value as Array<Record<string, unknown>>;
  if (rows.length === 0) return <EmptyState message="No data for this range." />;
  const columns: DataTableColumn<Record<string, unknown>>[] = Object.keys(rows[0]).map((key) => ({ header: key, value: (r) => String(r[key]) }));
  return <DataTable rows={rows} columns={columns} />;
}

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). Report Viewer —
 * runs one `reportRegistry.ts` entry via `GET /api/reports/[reportKey]`
 * and renders whatever it returned. Never computes a metric itself;
 * chart-vs-table-vs-card is a purely presentational decision made here
 * from the *shape* of an already-computed value.
 */
export default function ReportViewerPage({ params }: { params: Promise<{ reportKey: string }> }) {
  const { reportKey } = use(params);
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const definitionsQuery = useReportDefinitions(organizationId);
  const { data: staffList = [] } = useStaff();
  const [filters, setFilters] = useState<ReportFilterValues>({});

  const definition = useMemo(() => (definitionsQuery.data ?? []).find((r) => r.key === reportKey), [definitionsQuery.data, reportKey]);
  const runQuery = useReportRun(organizationId, definition ? reportKey : null, filters);

  if (permissionsQuery.isPending || definitionsQuery.isPending) {
    return (
      <div className="sx-loading" aria-busy="true">
        <span className="sx-skeleton" style={{ width: '90%' }} />
        <span className="sx-skeleton" style={{ width: '70%' }} />
        <span className="sx-skeleton" style={{ width: '80%' }} />
        <span className="sr-only">Loading report…</span>
      </div>
    );
  }

  const permissions = permissionsQuery.data?.permissions ?? [];
  if (!permissions.includes('report.view')) {
    return <EmptyState message="You don't have access to reports for this organization." />;
  }
  if (!definition) {
    return <EmptyState message="This report doesn't exist, or you don't have permission to view it." />;
  }

  const canExport = permissions.includes('report.export');

  return (
    <div>
      <Link href="/reports" className="sx-back">
        ← Reports
      </Link>
      <div className="sx-page-header">
        <div>
          <h1 className="sx-page-title">{definition.displayName}</h1>
          {definition.description && <p className="sx-page-desc">{definition.description}</p>}
        </div>
        {canExport && (
          <a href={exportReportCsvUrl(organizationId, reportKey, filters)} className="sx-btn sx-btn-secondary">
            Export CSV
          </a>
        )}
      </div>

      <FilterBar allowedFilters={definition.defaultFilters} values={filters} onChange={setFilters} staffList={staffList} />

      {runQuery.isPending && (
        <div className="sx-loading" aria-busy="true">
          <span className="sx-skeleton" style={{ width: '90%' }} />
          <span className="sx-skeleton" style={{ width: '70%' }} />
          <span className="sr-only">Loading…</span>
        </div>
      )}
      {runQuery.isError && (
        <div className="sx-error-state" role="alert">
          Something went wrong loading this report.
        </div>
      )}

      {runQuery.data?.kind === 'financial' && (
        <div className={styles.body}>{renderFinancialData(runQuery.data.financialReportKey, runQuery.data.data)}</div>
      )}

      {runQuery.data?.kind === 'metrics' && (
        <>
          {/* SOLIS Final Phase §4.2: scalar metrics (MetricCard output) go
              in the shared .sx-kpis strip, max-width 640px, per spec.
              Array-shaped metrics (charts/tables — not plain stat cards)
              keep the pre-existing grid, since .sx-kpis is a fixed-height
              strip layout that was never meant to host a bar/donut chart
              or a data table — the spec's own "Known gaps" section (§11)
              notes it wasn't built from a live session, so this scoping
              is a deliberate, conservative read rather than forcing every
              shape into the KPI strip. */}
          {runQuery.data.metrics.some((m) => !Array.isArray(m.value)) && (
            <div className="sx-kpis" style={{ maxWidth: 640 }}>
              {runQuery.data.metrics
                .filter((m) => !Array.isArray(m.value))
                .map((metric) => {
                  const metricDef = getMetricDefinition(metric.metricKey);
                  return (
                    <div key={metric.metricKey} className={styles.metricSlot}>
                      {renderMetricValue(metric.metricKey, metric.value, metricDef?.dataType ?? 'count', metricDef?.unit ?? '', metric.displayName)}
                    </div>
                  );
                })}
            </div>
          )}
          {runQuery.data.metrics.some((m) => Array.isArray(m.value)) && (
            <div className={styles.metricsGrid}>
              {runQuery.data.metrics
                .filter((m) => Array.isArray(m.value))
                .map((metric) => {
                  const metricDef = getMetricDefinition(metric.metricKey);
                  return (
                    <div key={metric.metricKey} className={styles.metricSlot}>
                      {renderMetricValue(metric.metricKey, metric.value, metricDef?.dataType ?? 'count', metricDef?.unit ?? '', metric.displayName)}
                    </div>
                  );
                })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
