import type { PermissionKey } from '../rbac/permissionCatalog';
import type { MetricFilterKey, MetricKey } from './metricRegistry';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). The complete,
 * closed catalog of report definitions — mirrors `metricRegistry.ts`'s
 * own pattern exactly: in-code, git-versioned, never user-editable (no
 * arbitrary end-user report/query builder — an explicit scope boundary
 * for this phase). A report groups one or more metrics under a single
 * viewable/exportable/filterable surface; it never computes anything
 * itself — `services/reportingService.ts` and the pre-existing
 * `services/financialReportsService.ts` (Phase 31, reused verbatim) do
 * that.
 *
 * The 5 Phase 31 financial reports (`getTrialBalance`, `getGeneralLedgerDetail`,
 * `getBalanceSheet`, `getProfitAndLoss`, `getArAgingReport`) are registered
 * here as `financialReportKey`-tagged entries rather than `metrics:` lists —
 * they return their own rich, differently-shaped result, not a flat metric
 * value set, so the Report Viewer branches on `financialReportKey` when
 * present and renders that report's own existing panel/table shape instead
 * of a generic metric-card/table layout.
 */

export type ReportCategory = 'operational' | 'financial' | 'staff' | 'documents' | 'commerce';

export type ReportDefinition = {
  key: string;
  displayName: string;
  category: ReportCategory;
  description: string;
  metrics: readonly MetricKey[];
  /** When set, the Report Viewer runs this Phase 31 report function
      instead of the generic metric-registry path — see file header. */
  financialReportKey?: 'trialBalance' | 'generalLedgerDetail' | 'balanceSheet' | 'profitAndLoss' | 'arAging' | 'transactionRegister';
  defaultFilters: readonly MetricFilterKey[];
  permission: PermissionKey;
};

export const REPORT_REGISTRY = [
  {
    key: 'active-cases',
    displayName: 'Active Cases',
    category: 'operational',
    description: 'Cases currently open, broken down by workflow stage.',
    metrics: ['cases.active', 'cases.stage.count'],
    financialReportKey: undefined,
    defaultFilters: ['location', 'staff'],
    permission: 'report.operational',
  },
  {
    key: 'case-intake-volume',
    displayName: 'Case Intake Volume',
    category: 'operational',
    description: 'New cases created over time.',
    metrics: ['cases.created'],
    financialReportKey: undefined,
    defaultFilters: ['dateRange', 'location'],
    permission: 'report.operational',
  },
  {
    key: 'case-completion',
    displayName: 'Case Completion',
    category: 'operational',
    description: 'Cases completed and their average end-to-end cycle time.',
    metrics: ['cases.completed', 'cases.average_cycle_days'],
    financialReportKey: undefined,
    defaultFilters: ['dateRange'],
    permission: 'report.operational',
  },
  {
    key: 'workflow-stage-aging',
    displayName: 'Workflow Stage Aging',
    category: 'operational',
    description: 'Average time cases currently in each stage have been waiting there.',
    metrics: ['cases.stage.average_days'],
    financialReportKey: undefined,
    defaultFilters: [],
    permission: 'report.operational',
  },
  {
    key: 'sla-exceptions',
    displayName: 'SLA Exceptions',
    category: 'operational',
    description: 'Cases past their per-stage SLA target.',
    metrics: ['cases.overdue'],
    financialReportKey: undefined,
    defaultFilters: ['stage', 'staff'],
    permission: 'report.operational',
  },
  {
    key: 'open-overdue-tasks',
    displayName: 'Open & Overdue Tasks',
    category: 'operational',
    description: 'Open tasks org-wide, and how many are past their due date.',
    metrics: ['tasks.open', 'tasks.overdue'],
    financialReportKey: undefined,
    defaultFilters: ['staff'],
    permission: 'report.operational',
  },
  {
    key: 'upcoming-appointments',
    displayName: 'Upcoming Appointments',
    category: 'operational',
    description: 'Scheduled and confirmed appointments, plus completion and no-show counts.',
    metrics: ['appointments.upcoming', 'appointments.completed', 'appointments.no_show'],
    financialReportKey: undefined,
    defaultFilters: ['dateRange', 'staff', 'location'],
    permission: 'report.operational',
  },
  {
    key: 'resource-utilization',
    displayName: 'Resource Utilization',
    category: 'operational',
    description: 'Booked hours per schedulable resource.',
    metrics: ['resource.utilization'],
    financialReportKey: undefined,
    defaultFilters: ['dateRange', 'resource'],
    permission: 'report.operational',
  },
  {
    key: 'va-case-status',
    displayName: 'VA Case Status',
    category: 'operational',
    description: 'Veteran cases broken down by VA-steps completion status.',
    metrics: ['cases.veteran_status'],
    financialReportKey: undefined,
    defaultFilters: [],
    permission: 'report.operational',
  },
  {
    key: 'revenue-summary',
    displayName: 'Revenue Summary',
    category: 'financial',
    description: 'Gross revenue recognized and average revenue per case.',
    metrics: ['revenue.gross', 'revenue.average_per_case'],
    financialReportKey: undefined,
    defaultFilters: ['dateRange'],
    permission: 'accounting.report',
  },
  {
    key: 'collections-summary',
    displayName: 'Collections Summary',
    category: 'financial',
    description: 'Cash actually collected from payments.',
    metrics: ['revenue.collected'],
    financialReportKey: undefined,
    defaultFilters: ['dateRange'],
    permission: 'accounting.report',
  },
  {
    key: 'outstanding-balance',
    displayName: 'Outstanding Balance',
    category: 'financial',
    description: 'Total accounts receivable currently outstanding.',
    metrics: ['ar.total'],
    financialReportKey: undefined,
    defaultFilters: [],
    permission: 'accounting.report',
  },
  {
    key: 'ar-aging',
    displayName: 'AR Aging',
    category: 'financial',
    description: 'Outstanding accounts receivable, grouped by age bucket.',
    metrics: ['ar.aging.current', 'ar.aging.30', 'ar.aging.60', 'ar.aging.90_plus'],
    financialReportKey: 'arAging',
    defaultFilters: [],
    permission: 'accounting.report',
  },
  {
    key: 'payment-history',
    displayName: 'Payment History',
    category: 'financial',
    description: 'Pending and failed payments org-wide.',
    metrics: ['payments.pending', 'payments.failed'],
    financialReportKey: undefined,
    defaultFilters: ['dateRange'],
    permission: 'accounting.report',
  },
  {
    key: 'general-ledger',
    displayName: 'General Ledger',
    category: 'financial',
    description: 'Posted journal entry lines for a date range, optionally scoped to one account.',
    metrics: [],
    financialReportKey: 'generalLedgerDetail',
    defaultFilters: ['dateRange'],
    permission: 'accounting.report',
  },
  {
    key: 'trial-balance',
    displayName: 'Trial Balance',
    category: 'financial',
    description: 'Every account and its debit/credit balance as of a date.',
    metrics: [],
    financialReportKey: 'trialBalance',
    defaultFilters: ['dateRange'],
    permission: 'accounting.report',
  },
  {
    key: 'profit-and-loss',
    displayName: 'Profit & Loss',
    category: 'financial',
    description: 'Revenue and expenses for a date range.',
    metrics: [],
    financialReportKey: 'profitAndLoss',
    defaultFilters: ['dateRange'],
    permission: 'accounting.report',
  },
  {
    key: 'balance-sheet',
    displayName: 'Balance Sheet',
    category: 'financial',
    description: 'Assets, liabilities, and equity as of a date.',
    metrics: [],
    financialReportKey: 'balanceSheet',
    defaultFilters: ['dateRange'],
    permission: 'accounting.report',
  },
  {
    key: 'transaction-register',
    displayName: 'Transaction Register',
    category: 'financial',
    description: 'Every posted financial transaction for a date range.',
    metrics: [],
    financialReportKey: 'transactionRegister',
    defaultFilters: ['dateRange'],
    permission: 'accounting.report',
  },
  {
    key: 'active-cases-by-staff',
    displayName: 'Active Cases by Staff',
    category: 'staff',
    description: 'Active case count per staff member.',
    metrics: ['staff.active_case_count'],
    financialReportKey: undefined,
    defaultFilters: ['staff', 'dateRange'],
    permission: 'report.staff',
  },
  {
    key: 'open-tasks-by-staff',
    displayName: 'Open Tasks by Staff',
    category: 'staff',
    description: 'Open task count per staff member.',
    metrics: ['staff.open_task_count'],
    financialReportKey: undefined,
    defaultFilters: ['staff'],
    permission: 'report.staff',
  },
  {
    key: 'appointment-load',
    displayName: 'Appointment Load',
    category: 'staff',
    description: 'Owned appointment count per staff member.',
    metrics: ['staff.appointment_load'],
    financialReportKey: undefined,
    defaultFilters: ['staff', 'dateRange'],
    permission: 'report.staff',
  },
  {
    key: 'case-ownership',
    displayName: 'Case Ownership',
    category: 'staff',
    description: 'Active case and open task counts per staff member, side by side.',
    metrics: ['staff.active_case_count', 'staff.open_task_count'],
    financialReportKey: undefined,
    defaultFilters: ['staff'],
    permission: 'report.staff',
  },
  {
    key: 'workload-summary',
    displayName: 'Workload Summary',
    category: 'staff',
    description: 'Cases, tasks, and appointment load per staff member, combined.',
    metrics: ['staff.active_case_count', 'staff.open_task_count', 'staff.appointment_load'],
    financialReportKey: undefined,
    defaultFilters: ['staff', 'dateRange'],
    permission: 'report.staff',
  },
  {
    key: 'documents-generated',
    displayName: 'Documents Generated',
    category: 'documents',
    description: 'Documents generated from a template over time.',
    metrics: ['documents.generated'],
    financialReportKey: undefined,
    defaultFilters: ['dateRange'],
    permission: 'report.operational',
  },
  {
    key: 'outstanding-signatures',
    displayName: 'Outstanding Signatures',
    category: 'documents',
    description: 'Signature requests awaiting completion.',
    metrics: ['signatures.pending'],
    financialReportKey: undefined,
    defaultFilters: [],
    permission: 'report.operational',
  },
  {
    key: 'signature-completion-time',
    displayName: 'Signature Completion Time',
    category: 'documents',
    description: 'Average time from issuing a signature request to it being signed.',
    metrics: ['signatures.completion_time_avg_hours'],
    financialReportKey: undefined,
    defaultFilters: ['dateRange'],
    permission: 'report.operational',
  },

  // Phase 35 (Merchandise, Inventory & Commerce).
  {
    key: 'merchandise-performance',
    displayName: 'Merchandise Performance',
    category: 'commerce',
    description: 'Merchandise revenue, cost of goods sold, and gross margin — all ledger-derived.',
    metrics: ['merchandise.revenue', 'merchandise.cogs', 'merchandise.gross_margin'],
    financialReportKey: undefined,
    defaultFilters: [],
    permission: 'accounting.report',
  },
  {
    key: 'inventory-position',
    displayName: 'Inventory Position',
    category: 'commerce',
    description: 'Inventory asset value, total units on hand, and low-stock product count.',
    metrics: ['inventory.asset_value', 'inventory.on_hand_units', 'inventory.low_stock_count'],
    financialReportKey: undefined,
    defaultFilters: [],
    permission: 'inventory.read',
  },
] as const satisfies readonly ReportDefinition[];

export type ReportKey = (typeof REPORT_REGISTRY)[number]['key'];

const REPORT_BY_KEY: ReadonlyMap<string, ReportDefinition> = new Map(REPORT_REGISTRY.map((r) => [r.key, r]));

export function getReportDefinition(key: string): ReportDefinition | undefined {
  return REPORT_BY_KEY.get(key);
}

export function listReportDefinitionsForPermissions(grantedPermissions: ReadonlySet<PermissionKey>): readonly ReportDefinition[] {
  return REPORT_REGISTRY.filter((r) => grantedPermissions.has(r.permission));
}
