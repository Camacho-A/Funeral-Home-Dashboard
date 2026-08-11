import type { PermissionKey } from '../rbac/permissionCatalog';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). The complete,
 * closed catalog of stable, machine-readable metric identifiers Beacon's
 * reporting layer can ever compute — mirrors
 * `domain/rbac/permissionCatalog.ts`'s own pattern exactly: an in-code,
 * developer-defined, git-versioned list, never a database table and
 * never user-editable (no arbitrary end-user formula builder — an
 * explicit scope boundary for this phase). A `key` is always a stable
 * dot-namespaced identifier (`cases.active`), never a display string —
 * `displayName` is the only place a human-facing label lives.
 *
 * Every metric's `source` names the real `services/reportingService.ts`
 * or `services/financialReportsService.ts` function that computes it —
 * this file only *describes* a metric, it never computes one itself.
 * See docs/adr/ADR-036-reporting-analytics-executive-dashboard-architecture.md.
 */

export type MetricDataType = 'count' | 'currency' | 'percentage' | 'days' | 'hours' | 'ratio';

export type MetricFilterKey =
  | 'dateRange'
  | 'location'
  | 'staff'
  | 'case'
  | 'stage'
  | 'serviceType'
  | 'appointmentType'
  | 'paymentStatus'
  | 'documentType'
  | 'signatureStatus'
  | 'resource';

export type MetricDefinition = {
  key: string;
  displayName: string;
  description: string;
  dataType: MetricDataType;
  unit: string;
  /** The real function (in `reportingService.ts` or
      `financialReportsService.ts`) that computes this metric — this
      registry entry only documents the mapping, it never computes
      anything itself. */
  source: string;
  allowedFilters: readonly MetricFilterKey[];
  permission: PermissionKey;
};

export const METRIC_REGISTRY = [
  {
    key: 'cases.active',
    displayName: 'Active Cases',
    description: 'Cases not yet on the terminal workflow stage.',
    dataType: 'count',
    unit: 'cases',
    source: 'reportingService.countActiveCases',
    allowedFilters: ['staff'],
    permission: 'report.operational',
  },
  {
    key: 'cases.created',
    displayName: 'New Cases',
    description: 'Cases created within the given date range.',
    dataType: 'count',
    unit: 'cases',
    source: 'reportingService.countCasesCreated',
    allowedFilters: ['dateRange'],
    permission: 'report.operational',
  },
  {
    key: 'cases.completed',
    displayName: 'Cases Completed',
    description: 'Cases that reached the terminal stage within the given date range. Derives from activityEvents\' stage-change history — wix-mode only (see docs/adr/ADR-036).',
    dataType: 'count',
    unit: 'cases',
    source: 'reportingService.countCasesCompleted',
    allowedFilters: ['dateRange'],
    permission: 'report.operational',
  },
  {
    key: 'cases.average_cycle_days',
    displayName: 'Avg. Cycle Time',
    description: 'Average days from case creation to reaching the terminal stage. Derives from activityEvents\' stage-change history — wix-mode only.',
    dataType: 'days',
    unit: 'days',
    source: 'reportingService.averageCaseCycleDays',
    allowedFilters: ['dateRange'],
    permission: 'report.operational',
  },
  {
    key: 'cases.overdue',
    displayName: 'Overdue Cases',
    description: 'Cases past their per-stage SLA target — reuses domain/cases/sla.ts#isOverdue, never recomputed.',
    dataType: 'count',
    unit: 'cases',
    source: 'reportingService.countOverdueCases',
    allowedFilters: ['stage', 'staff'],
    permission: 'report.operational',
  },
  {
    key: 'cases.stage.count',
    displayName: 'Cases by Stage',
    description: 'Case count grouped by current workflow stage.',
    dataType: 'count',
    unit: 'cases',
    source: 'reportingService.caseCountsByStage',
    allowedFilters: [],
    permission: 'report.operational',
  },
  {
    key: 'cases.stage.average_days',
    displayName: 'Avg. Days in Stage (current)',
    description: 'Average of the live daysWaitingInStage across cases currently in each stage — a point-in-time snapshot, distinct from cases.average_cycle_days\' true historical duration.',
    dataType: 'days',
    unit: 'days',
    source: 'reportingService.averageDaysInStageSnapshot',
    allowedFilters: [],
    permission: 'report.operational',
  },
  {
    key: 'cases.veteran_status',
    displayName: 'VA Case Status',
    description: 'Veteran cases broken down by VA-steps completion status — preserved from the pre-Phase-32 Reports page.',
    dataType: 'count',
    unit: 'cases',
    source: 'reportingService.veteranCaseStatusBreakdown',
    allowedFilters: [],
    permission: 'report.operational',
  },
  {
    key: 'tasks.open',
    displayName: 'Open Tasks',
    description: 'Tasks not yet marked done.',
    dataType: 'count',
    unit: 'tasks',
    source: 'reportingService.countOpenTasks',
    allowedFilters: ['staff'],
    permission: 'report.operational',
  },
  {
    key: 'tasks.overdue',
    displayName: 'Overdue Tasks',
    description: 'Open tasks whose dueDate has passed (Phase 32 field addition).',
    dataType: 'count',
    unit: 'tasks',
    source: 'reportingService.countOverdueTasks',
    allowedFilters: ['staff'],
    permission: 'report.operational',
  },
  {
    key: 'appointments.upcoming',
    displayName: 'Upcoming Appointments',
    description: 'Scheduled/confirmed appointments starting within the given date range.',
    dataType: 'count',
    unit: 'appointments',
    source: 'reportingService.countUpcomingAppointments',
    allowedFilters: ['dateRange', 'staff', 'location'],
    permission: 'report.operational',
  },
  {
    key: 'appointments.completed',
    displayName: 'Completed Appointments',
    description: 'Appointments marked completed within the given date range.',
    dataType: 'count',
    unit: 'appointments',
    source: 'reportingService.countAppointmentsByStatus',
    allowedFilters: ['dateRange'],
    permission: 'report.operational',
  },
  {
    key: 'appointments.no_show',
    displayName: 'No-Shows',
    description: 'Appointments marked no_show within the given date range.',
    dataType: 'count',
    unit: 'appointments',
    source: 'reportingService.countAppointmentsByStatus',
    allowedFilters: ['dateRange'],
    permission: 'report.operational',
  },
  {
    key: 'resource.utilization',
    displayName: 'Resource Booked Hours',
    description: 'Total booked hours per resource within the given date range — a duration metric, not a capacity percentage (no business-hours/capacity model exists to divide by; disclosed, not invented).',
    dataType: 'hours',
    unit: 'hours',
    source: 'reportingService.resourceBookedHours',
    allowedFilters: ['dateRange', 'resource'],
    permission: 'report.operational',
  },
  {
    key: 'revenue.gross',
    displayName: 'Gross Revenue',
    description: 'Sum of posted Service Revenue (4000) journal lines within the given date range.',
    dataType: 'currency',
    unit: 'cents',
    source: 'reportingService.grossRevenue',
    allowedFilters: ['dateRange'],
    permission: 'accounting.report',
  },
  {
    key: 'revenue.collected',
    displayName: 'Cash Collected',
    description: 'Sum of Undeposited Funds (1100) debits from payment-sourced journal entries within the given date range.',
    dataType: 'currency',
    unit: 'cents',
    source: 'reportingService.cashCollected',
    allowedFilters: ['dateRange'],
    permission: 'accounting.report',
  },
  {
    key: 'revenue.average_per_case',
    displayName: 'Avg. Revenue / Case',
    description: 'Gross revenue divided by the number of distinct cases with a posted CaseOrder in the given date range.',
    dataType: 'currency',
    unit: 'cents',
    source: 'reportingService.averageRevenuePerCase',
    allowedFilters: ['dateRange'],
    permission: 'accounting.report',
  },
  {
    key: 'ar.total',
    displayName: 'Total AR',
    description: 'The general ledger\'s own derived Accounts Receivable balance.',
    dataType: 'currency',
    unit: 'cents',
    source: 'financialReportsService.getArAgingReport',
    allowedFilters: [],
    permission: 'accounting.report',
  },
  {
    key: 'ar.aging.current',
    displayName: 'AR Aging — Current (0-30 days)',
    description: 'Sum of open balances in the 0-30 day aging bucket.',
    dataType: 'currency',
    unit: 'cents',
    source: 'financialReportsService.getArAgingReport',
    allowedFilters: [],
    permission: 'accounting.report',
  },
  {
    key: 'ar.aging.30',
    displayName: 'AR Aging — 31-60 days',
    description: 'Sum of open balances in the 31-60 day aging bucket.',
    dataType: 'currency',
    unit: 'cents',
    source: 'financialReportsService.getArAgingReport',
    allowedFilters: [],
    permission: 'accounting.report',
  },
  {
    key: 'ar.aging.60',
    displayName: 'AR Aging — 61-90 days',
    description: 'Sum of open balances in the 61-90 day aging bucket.',
    dataType: 'currency',
    unit: 'cents',
    source: 'financialReportsService.getArAgingReport',
    allowedFilters: [],
    permission: 'accounting.report',
  },
  {
    key: 'ar.aging.90_plus',
    displayName: 'AR Aging — 90+ days',
    description: 'Sum of open balances in the 90+ day aging bucket.',
    dataType: 'currency',
    unit: 'cents',
    source: 'financialReportsService.getArAgingReport',
    allowedFilters: [],
    permission: 'accounting.report',
  },
  {
    key: 'payments.pending',
    displayName: 'Pending Payments',
    description: 'Payment records currently in pending status, org-wide.',
    dataType: 'count',
    unit: 'payments',
    source: 'reportingService.countPaymentsByStatus',
    allowedFilters: ['dateRange'],
    permission: 'accounting.report',
  },
  {
    key: 'payments.failed',
    displayName: 'Failed Payments',
    description: 'Payment records currently in failed status, org-wide.',
    dataType: 'count',
    unit: 'payments',
    source: 'reportingService.countPaymentsByStatus',
    allowedFilters: ['dateRange'],
    permission: 'accounting.report',
  },
  {
    key: 'documents.generated',
    displayName: 'Documents Generated',
    description: 'CaseDocuments with origin \'generated\' within the given date range.',
    dataType: 'count',
    unit: 'documents',
    source: 'reportingService.countDocumentsGenerated',
    allowedFilters: ['dateRange'],
    permission: 'report.operational',
  },
  {
    key: 'signatures.pending',
    displayName: 'Pending Signatures',
    description: 'Signature requests in draft/pending/viewed status, org-wide.',
    dataType: 'count',
    unit: 'requests',
    source: 'reportingService.countOutstandingSignatures',
    allowedFilters: [],
    permission: 'report.operational',
  },
  {
    key: 'signatures.completion_time_avg_hours',
    displayName: 'Avg. Signature Time',
    description: 'Average hours from issuedAt to signedAt for completed signature requests in the given date range.',
    dataType: 'hours',
    unit: 'hours',
    source: 'reportingService.averageSignatureCompletionHours',
    allowedFilters: ['dateRange'],
    permission: 'report.operational',
  },
  {
    key: 'notifications.unread',
    displayName: 'My Unread Notifications',
    description: 'The calling identity\'s own unread in-app notification count — reuses notificationService.getUnreadCount verbatim; per-caller, not an organization-wide aggregate.',
    dataType: 'count',
    unit: 'notifications',
    source: 'notificationService.getUnreadCount',
    allowedFilters: [],
    permission: 'report.view',
  },
  {
    key: 'staff.active_case_count',
    displayName: 'Active Cases (by staff)',
    description: 'Active case count per StaffProfile — resolved via StaffProfile.id, never by display name/email.',
    dataType: 'count',
    unit: 'cases',
    source: 'reportingService.staffWorkload',
    allowedFilters: ['staff', 'dateRange'],
    permission: 'report.staff',
  },
  {
    key: 'staff.open_task_count',
    displayName: 'Open Tasks (by staff)',
    description: 'Open task count per StaffProfile.',
    dataType: 'count',
    unit: 'tasks',
    source: 'reportingService.staffWorkload',
    allowedFilters: ['staff'],
    permission: 'report.staff',
  },
  {
    key: 'staff.appointment_load',
    displayName: 'Appointment Load (by staff)',
    description: 'Owned appointment count per StaffProfile within the given date range.',
    dataType: 'count',
    unit: 'appointments',
    source: 'reportingService.staffAppointmentLoad',
    allowedFilters: ['staff', 'dateRange'],
    permission: 'report.staff',
  },
] as const satisfies readonly MetricDefinition[];

export type MetricKey = (typeof METRIC_REGISTRY)[number]['key'];

const METRIC_BY_KEY: ReadonlyMap<string, MetricDefinition> = new Map(METRIC_REGISTRY.map((m) => [m.key, m]));

export function getMetricDefinition(key: string): MetricDefinition | undefined {
  return METRIC_BY_KEY.get(key);
}
