import type { DataAdapterMode } from '../lib/env';
import { buildCsv, EXPORT_ROW_CAP, type CsvColumn } from '../domain/reporting/csvExport';
import { runReport, type ReportRunResult, type MetricResult, ReportRunnerError, type ReportFilters } from './reportingService';
import type {
  TrialBalanceReportRow,
  GeneralLedgerDetailRow,
  BalanceSheetLine,
  TransactionRegisterRow,
  ArAgingRow,
} from './financialReportsService';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). The one CSV
 * exporter every report in `domain/reporting/reportRegistry.ts` shares —
 * built on the same `domain/reporting/csvExport.ts#buildCsv` helper
 * `services/activityService.ts`'s own `exportCsv` uses (Phase 24), so
 * this is the second, not a duplicate, CSV implementation in this
 * codebase. Never recomputes a report — always calls
 * `reportingService.runReport` first and serializes whatever it
 * returned.
 */

function metricsColumns(): ReadonlyArray<CsvColumn<MetricResult>> {
  return [
    { header: 'metricKey', value: (m) => m.metricKey },
    { header: 'displayName', value: (m) => m.displayName },
    // Array/object-valued metrics (e.g. cases.stage.count's per-stage
    // breakdown) serialize to one JSON cell rather than being flattened
    // into further rows — a deliberate, disclosed simplification; richer
    // per-row flattening is a reserved extension point, not built this
    // phase (see this phase's own Exports scope boundary).
    { header: 'value', value: (m) => (typeof m.value === 'object' && m.value !== null ? JSON.stringify(m.value) : String(m.value)) },
  ];
}

const TRIAL_BALANCE_COLUMNS: ReadonlyArray<CsvColumn<TrialBalanceReportRow>> = [
  { header: 'accountNumber', value: (r) => r.accountNumber },
  { header: 'accountName', value: (r) => r.accountName },
  { header: 'accountType', value: (r) => r.accountType },
  { header: 'debitTotal', value: (r) => String(r.debitTotal) },
  { header: 'creditTotal', value: (r) => String(r.creditTotal) },
];

type BalanceSheetSectionRow = BalanceSheetLine & { section: string };
const BALANCE_SHEET_COLUMNS: ReadonlyArray<CsvColumn<BalanceSheetSectionRow>> = [
  { header: 'section', value: (r) => r.section },
  { header: 'accountNumber', value: (r) => r.accountNumber },
  { header: 'accountName', value: (r) => r.accountName },
  { header: 'amount', value: (r) => String(r.amount) },
];

const GENERAL_LEDGER_COLUMNS: ReadonlyArray<CsvColumn<GeneralLedgerDetailRow>> = [
  { header: 'entryDate', value: (r) => r.entryDate },
  { header: 'entryNumber', value: (r) => r.entryNumber },
  { header: 'memo', value: (r) => r.memo },
  { header: 'direction', value: (r) => r.direction },
  { header: 'amount', value: (r) => String(r.amount) },
  { header: 'caseId', value: (r) => r.caseId ?? '' },
];

const TRANSACTION_REGISTER_COLUMNS: ReadonlyArray<CsvColumn<TransactionRegisterRow>> = [
  { header: 'entryDate', value: (r) => r.entryDate },
  { header: 'entryNumber', value: (r) => r.entryNumber },
  { header: 'sourceType', value: (r) => r.sourceType },
  { header: 'memo', value: (r) => r.memo },
  { header: 'caseId', value: (r) => r.caseId ?? '' },
  { header: 'totalAmount', value: (r) => String(r.totalAmount) },
];

const AR_AGING_COLUMNS: ReadonlyArray<CsvColumn<ArAgingRow>> = [
  { header: 'caseId', value: (r) => r.caseId },
  { header: 'caseOrderId', value: (r) => r.caseOrderId },
  { header: 'balanceDue', value: (r) => String(r.balanceDue) },
  { header: 'anchorDate', value: (r) => r.anchorDate },
  { header: 'ageDays', value: (r) => String(r.ageDays) },
  { header: 'bucket', value: (r) => r.bucket },
];

function financialReportCsv(result: Extract<ReportRunResult, { kind: 'financial' }>): string {
  const data = result.data as Record<string, unknown>;
  switch (result.financialReportKey) {
    case 'trialBalance':
      return buildCsv((data.rows as TrialBalanceReportRow[]).slice(0, EXPORT_ROW_CAP), TRIAL_BALANCE_COLUMNS);
    case 'generalLedgerDetail':
      return buildCsv((data.rows as GeneralLedgerDetailRow[]).slice(0, EXPORT_ROW_CAP), GENERAL_LEDGER_COLUMNS);
    case 'transactionRegister':
      return buildCsv((data as unknown as TransactionRegisterRow[]).slice(0, EXPORT_ROW_CAP), TRANSACTION_REGISTER_COLUMNS);
    case 'arAging':
      return buildCsv((data.rows as ArAgingRow[]).slice(0, EXPORT_ROW_CAP), AR_AGING_COLUMNS);
    case 'balanceSheet': {
      const rows: BalanceSheetSectionRow[] = [
        ...(data.assets as BalanceSheetLine[]).map((l) => ({ ...l, section: 'assets' })),
        ...(data.liabilities as BalanceSheetLine[]).map((l) => ({ ...l, section: 'liabilities' })),
        ...(data.equity as BalanceSheetLine[]).map((l) => ({ ...l, section: 'equity' })),
      ];
      return buildCsv(rows.slice(0, EXPORT_ROW_CAP), BALANCE_SHEET_COLUMNS);
    }
    case 'profitAndLoss': {
      const rows: BalanceSheetSectionRow[] = [
        ...(data.revenue as BalanceSheetLine[]).map((l) => ({ ...l, section: 'revenue' })),
        ...(data.expenses as BalanceSheetLine[]).map((l) => ({ ...l, section: 'expenses' })),
      ];
      return buildCsv(rows.slice(0, EXPORT_ROW_CAP), BALANCE_SHEET_COLUMNS);
    }
    default:
      throw new ReportRunnerError(`No CSV column mapping for financialReportKey "${result.financialReportKey}".`);
  }
}

/** Runs the named report and serializes it to CSV — the export always
    uses the exact same `filters`/permission-gated report the caller could
    already view, never a wider query (routes enforce `report.export` on
    top of the report's own view permission before calling this). */
export async function exportReportCsv(organizationId: string, reportKey: string, filters: ReportFilters, dataAdapterMode: DataAdapterMode = 'mock'): Promise<string> {
  const result = await runReport(organizationId, reportKey, filters, dataAdapterMode);
  if (result.kind === 'financial') return financialReportCsv(result);
  return buildCsv(result.metrics.slice(0, EXPORT_ROW_CAP), metricsColumns());
}
