import type { DataAdapterMode } from '../lib/env';
import type { CaseViewModel } from '../types/caseViewModel';
import type { StaffProfile } from '../types/staffProfile';
import type { AppointmentStatus } from '../types/appointment';
import type { PaymentRecordStatus } from '../types/payment';
import { buildCaseViewModel } from '../domain/cases/viewModel';
import { STAGES, LAST_DISPLAY_STAGE } from '../domain/cases/stages';
import {
  computeStageBreakdown,
  computeStaffWorkload,
  computeVeteranCaseStatuses,
  type StageBreakdownRow,
  type VeteranCaseStatusRow,
} from '../domain/reports/calculations';
import * as casesService from './casesService';
import * as tasksService from './tasksService';
import * as staffProfileService from './staffProfileService';
import { listAppointments } from './scheduling/appointmentReads';
import * as resourceService from './resourceService';
import { listForOrganization as listDocumentsForOrganization } from './documentService';
import { listRequestsForOrganization, isActiveSignatureRequestStatus } from './signatureService';
import { listPaymentRecordsForOrganization } from './paymentsService';
import { listForOrganization as listActivityForOrganization } from './activityService';
import { ACTIVITY_EVENT_TYPES } from '../types/activityEvent';
import {
  getProfitAndLoss,
  getArAgingReport,
  getTrialBalance,
  getGeneralLedgerDetail,
  getBalanceSheet,
  getTransactionRegister,
} from './financialReportsService';
import { listJournalEntriesForOrganization, getJournalEntryWithLines } from './generalLedgerService';
import { getAccountByNumber } from './chartOfAccountsService';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import { listActiveCaseOrdersForOrganization } from './pricingService';
import { getUnreadCount } from './notificationService';
import {
  merchandiseRevenue,
  merchandiseCogs,
  merchandiseGrossMargin,
  inventoryAssetValue,
  inventoryOnHandUnits,
  lowStockProductCount,
} from './merchandiseReportingService';
import { getReportDefinition, type ReportKey } from '../domain/reporting/reportRegistry';
import { getMetricDefinition, type MetricKey } from '../domain/reporting/metricRegistry';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). The operational,
 * staff, and revenue-recognition metric functions named in
 * `domain/reporting/metricRegistry.ts`'s own `source` column — this file
 * is what actually computes them. Every function composes read-only calls
 * into the same canonical services every other Beacon feature already
 * uses (`casesService`, `tasksService`, `staffProfileService`,
 * `scheduling/appointmentReads`, `resourceService`, `documentService`,
 * `signatureService`, `paymentsService`, `activityService`,
 * `financialReportsService`/`generalLedgerService`) — nothing here ever
 * recomputes a business rule those services already own (case stage/SLA
 * resolution reuses `domain/cases/viewModel.ts`/`domain/reports/calculations.ts`
 * verbatim; ledger balances reuse `financialReportsService.ts`/
 * `generalLedgerService.ts` verbatim). No Wix `COUNT` endpoint is ever
 * used (Phase 28's confirmed-unreliable finding) — every count here is a
 * bounded fetch-and-count over an already-fetched array.
 *
 * Filters are deliberately narrow per function — only the dimensions
 * `metricRegistry.ts` actually lists as `allowedFilters` for that metric
 * are threaded through; a filter a metric can't honor (e.g. `location` on
 * a `Case`, which has no location field) is never silently accepted.
 */

const DEFAULT_RANGE_DAYS = 90;

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** The bounded default every date-ranged metric/report falls back to when
    the caller doesn't supply one — mirrors this phase's own Performance
    Strategy ("default expensive reports to bounded ranges"). */
export function defaultDateRange(now: string = new Date().toISOString()): { fromDate: string; toDate: string } {
  return { fromDate: addDays(now, -DEFAULT_RANGE_DAYS), toDate: now };
}

// ---------------------------------------------------------------------------
// Shared case view-model loading — every case-based metric reuses this,
// never re-fetches/re-derives independently.
// ---------------------------------------------------------------------------

async function loadCaseViewModels(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<CaseViewModel[]> {
  const [cases, staffList] = await Promise.all([
    casesService.listForOrganization(organizationId, dataAdapterMode),
    staffProfileService.list(organizationId, dataAdapterMode),
  ]);
  return cases.map((c) => buildCaseViewModel(c, { staffList }));
}

// ---------------------------------------------------------------------------
// Case metrics
// ---------------------------------------------------------------------------

export async function countActiveCases(
  organizationId: string,
  filters: { staffProfileId?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<number> {
  const views = await loadCaseViewModels(organizationId, dataAdapterMode);
  return views.filter(
    (c) => c.displayStage < LAST_DISPLAY_STAGE && (filters.staffProfileId === undefined || c.ownerStaffId === filters.staffProfileId),
  ).length;
}

export async function countCasesCreated(
  organizationId: string,
  filters: { fromDate?: string; toDate?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<number> {
  const { fromDate, toDate } = { ...defaultDateRange(), ...filters };
  const cases = await casesService.listForOrganization(organizationId, dataAdapterMode);
  return cases.filter((c) => c.createdAt >= fromDate && c.createdAt <= toDate).length;
}

/** Every `case.stage.changed` event whose `newValue` names the terminal
    stage, within `[fromDate, toDate]` — see Finding 2 in the Phase 32
    plan: this has real data only where `casesService.ts`'s create/update
    paths call `activityService.recordCaseCreated`/`recordStageChanged`,
    which today is the `wix`-mode API routes only (`app/api/cases/*`), not
    this file's own `mock`-mode branch. Disclosed, not silently masked —
    see docs/adr/ADR-036. */
async function terminalStageChangeEvents(
  organizationId: string,
  filters: { fromDate?: string; toDate?: string },
  dataAdapterMode: DataAdapterMode,
): Promise<Array<{ caseId: string; createdAt: string }>> {
  const terminalLabel = STAGES[LAST_DISPLAY_STAGE];
  const { fromDate, toDate } = { ...defaultDateRange(), ...filters };
  const matches: Array<{ caseId: string; createdAt: string }> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const result = await listActivityForOrganization(organizationId, { category: 'cases' }, cursor, 200, dataAdapterMode);
    for (const event of result.events) {
      if (event.eventType !== ACTIVITY_EVENT_TYPES.CASE_STAGE_CHANGED || !event.caseId) continue;
      if (event.createdAt < fromDate || event.createdAt > toDate) continue;
      try {
        const parsed = JSON.parse(event.newValue ?? 'null') as { stage?: string } | null;
        if (parsed?.stage === terminalLabel) matches.push({ caseId: event.caseId, createdAt: event.createdAt });
      } catch {
        // Malformed newValue on a pre-Phase-24 row — skip rather than throw.
      }
    }
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return matches;
}

export async function countCasesCompleted(
  organizationId: string,
  filters: { fromDate?: string; toDate?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<number> {
  const events = await terminalStageChangeEvents(organizationId, filters, dataAdapterMode);
  return new Set(events.map((e) => e.caseId)).size;
}

/** Average days from `Case.createdAt` to that case's own first terminal-
    stage `case.stage.changed` event, for cases that reached it within
    `[fromDate, toDate]` — the true historical cycle-time metric, distinct
    from `averageDaysInStageSnapshot`'s live, currently-in-stage snapshot. */
export async function averageCaseCycleDays(
  organizationId: string,
  filters: { fromDate?: string; toDate?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<number> {
  const [events, cases] = await Promise.all([
    terminalStageChangeEvents(organizationId, filters, dataAdapterMode),
    casesService.listForOrganization(organizationId, dataAdapterMode),
  ]);
  const caseCreatedAt = new Map(cases.map((c) => [c.id, c.createdAt]));
  const days: number[] = [];
  for (const event of events) {
    const createdAt = caseCreatedAt.get(event.caseId);
    if (!createdAt) continue;
    const diffMs = new Date(event.createdAt).getTime() - new Date(createdAt).getTime();
    days.push(diffMs / (1000 * 60 * 60 * 24));
  }
  if (days.length === 0) return 0;
  return Math.round((days.reduce((sum, d) => sum + d, 0) / days.length) * 10) / 10;
}

export async function countOverdueCases(
  organizationId: string,
  filters: { stage?: string; staffProfileId?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<number> {
  const views = await loadCaseViewModels(organizationId, dataAdapterMode);
  return views.filter(
    (c) =>
      c.isOverdue &&
      (filters.stage === undefined || c.stageLabel === filters.stage) &&
      (filters.staffProfileId === undefined || c.ownerStaffId === filters.staffProfileId),
  ).length;
}

export type CaseStageCountRow = { stage: string; displayStage: number; count: number };

export async function caseCountsByStage(organizationId: string, dataAdapterMode: DataAdapterMode = 'mock'): Promise<CaseStageCountRow[]> {
  const views = await loadCaseViewModels(organizationId, dataAdapterMode);
  return STAGES.map((label, displayStage) => ({
    stage: label,
    displayStage,
    count: views.filter((c) => c.displayStage === displayStage).length,
  }));
}

/** Wraps `domain/reports/calculations.ts#computeStageBreakdown` verbatim —
    the live, currently-in-stage snapshot (see this metric's own registry
    description for how it differs from `averageCaseCycleDays`). */
export async function averageDaysInStageSnapshot(organizationId: string, dataAdapterMode: DataAdapterMode = 'mock'): Promise<StageBreakdownRow[]> {
  const views = await loadCaseViewModels(organizationId, dataAdapterMode);
  return computeStageBreakdown(views);
}

export async function veteranCaseStatusBreakdown(organizationId: string, dataAdapterMode: DataAdapterMode = 'mock'): Promise<VeteranCaseStatusRow[]> {
  const views = await loadCaseViewModels(organizationId, dataAdapterMode);
  return computeVeteranCaseStatuses(views);
}

// ---------------------------------------------------------------------------
// Task metrics
// ---------------------------------------------------------------------------

export async function countOpenTasks(
  organizationId: string,
  filters: { staffProfileId?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<number> {
  const tasks = await tasksService.listForOrganization(organizationId, dataAdapterMode);
  return tasks.filter((t) => !t.isDone && (filters.staffProfileId === undefined || t.assigneeStaffId === filters.staffProfileId)).length;
}

export async function countOverdueTasks(
  organizationId: string,
  filters: { staffProfileId?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<number> {
  const now = new Date().toISOString();
  const tasks = await tasksService.listForOrganization(organizationId, dataAdapterMode);
  return tasks.filter(
    (t) =>
      !t.isDone &&
      t.dueDate !== null &&
      t.dueDate < now &&
      (filters.staffProfileId === undefined || t.assigneeStaffId === filters.staffProfileId),
  ).length;
}

// ---------------------------------------------------------------------------
// Appointment metrics
// ---------------------------------------------------------------------------

export async function countUpcomingAppointments(
  organizationId: string,
  filters: { fromDate?: string; toDate?: string; staffProfileId?: string; locationId?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<number> {
  const { fromDate, toDate } = { ...defaultDateRange(), ...filters };
  const appointments = await listAppointments(organizationId, { from: fromDate, to: toDate }, dataAdapterMode);
  return appointments.filter(
    (a) =>
      (a.status === 'scheduled' || a.status === 'confirmed') &&
      (filters.staffProfileId === undefined || a.ownerStaffProfileId === filters.staffProfileId) &&
      (filters.locationId === undefined || a.locationId === filters.locationId),
  ).length;
}

export async function countAppointmentsByStatus(
  organizationId: string,
  status: AppointmentStatus,
  filters: { fromDate?: string; toDate?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<number> {
  const { fromDate, toDate } = { ...defaultDateRange(), ...filters };
  const appointments = await listAppointments(organizationId, { from: fromDate, to: toDate, status }, dataAdapterMode);
  return appointments.length;
}

// ---------------------------------------------------------------------------
// Resource metrics
// ---------------------------------------------------------------------------

export type ResourceBookedHoursRow = { resourceId: string; resourceName: string; hours: number };

/** Total booked hours per resource in `[fromDate, toDate]` — sums every
    non-released assignment's own denormalized `startAt`/`endAt`
    (`AppointmentResourceAssignment`, Phase 27), clipped to the window so a
    booking straddling the boundary only counts its in-range portion. A
    duration metric, not a capacity percentage — see this metric's own
    registry description for why (no business-hours/capacity model
    exists in this codebase to divide by). */
export async function resourceBookedHours(
  organizationId: string,
  filters: { fromDate?: string; toDate?: string; resourceId?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<ResourceBookedHoursRow[]> {
  const { fromDate, toDate } = { ...defaultDateRange(), ...filters };
  const resources = await resourceService.list(organizationId, filters.resourceId ? {} : {}, dataAdapterMode);
  const targets = filters.resourceId ? resources.filter((r) => r.id === filters.resourceId) : resources;
  const rows: ResourceBookedHoursRow[] = [];
  for (const resource of targets) {
    const { assignments } = await resourceService.getAvailability(organizationId, resource.id, fromDate, toDate, dataAdapterMode);
    let hours = 0;
    for (const a of assignments) {
      const clippedStart = a.startAt < fromDate ? fromDate : a.startAt;
      const clippedEnd = a.endAt > toDate ? toDate : a.endAt;
      const durationMs = new Date(clippedEnd).getTime() - new Date(clippedStart).getTime();
      if (durationMs > 0) hours += durationMs / (1000 * 60 * 60);
    }
    rows.push({ resourceId: resource.id, resourceName: resource.name, hours: Math.round(hours * 10) / 10 });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Document / signature metrics
// ---------------------------------------------------------------------------

export async function countDocumentsGenerated(
  organizationId: string,
  filters: { fromDate?: string; toDate?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<number> {
  const { fromDate, toDate } = { ...defaultDateRange(), ...filters };
  const documents = await listDocumentsForOrganization(organizationId, dataAdapterMode);
  return documents.filter((d) => d.origin === 'generated' && d.createdAt >= fromDate && d.createdAt <= toDate).length;
}

export async function countOutstandingSignatures(organizationId: string, dataAdapterMode: DataAdapterMode = 'mock'): Promise<number> {
  const requests = await listRequestsForOrganization(organizationId, dataAdapterMode);
  return requests.filter((r) => isActiveSignatureRequestStatus(r.status)).length;
}

export async function averageSignatureCompletionHours(
  organizationId: string,
  filters: { fromDate?: string; toDate?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<number> {
  const { fromDate, toDate } = { ...defaultDateRange(), ...filters };
  const requests = await listRequestsForOrganization(organizationId, dataAdapterMode);
  const completed = requests.filter((r) => r.status === 'signed' && r.signedAt !== null && r.signedAt >= fromDate && r.signedAt <= toDate);
  if (completed.length === 0) return 0;
  const hours = completed.map((r) => (new Date(r.signedAt!).getTime() - new Date(r.issuedAt).getTime()) / (1000 * 60 * 60));
  return Math.round((hours.reduce((sum, h) => sum + h, 0) / hours.length) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Payment metrics (payment-record status, distinct from the ledger below)
// ---------------------------------------------------------------------------

export async function countPaymentsByStatus(
  organizationId: string,
  status: PaymentRecordStatus,
  filters: { fromDate?: string; toDate?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<number> {
  const { fromDate, toDate } = { ...defaultDateRange(), ...filters };
  const payments = await listPaymentRecordsForOrganization(organizationId, { status, fromDate, toDate }, dataAdapterMode);
  return payments.length;
}

// ---------------------------------------------------------------------------
// Revenue metrics — reuse the Phase 31 ledger exclusively, never
// recompute a balance independently.
// ---------------------------------------------------------------------------

/** `financialReportsService.getProfitAndLoss`'s own `totalRevenue` for the
    range — this file never re-sums Service Revenue lines itself. */
export async function grossRevenue(
  organizationId: string,
  filters: { fromDate?: string; toDate?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<number> {
  const { fromDate, toDate } = { ...defaultDateRange(), ...filters };
  const report = await getProfitAndLoss(organizationId, dataAdapterMode, { fromDate, toDate });
  return report.totalRevenue;
}

/** Sum of debits to Undeposited Funds (1100) from `sourceType: 'payment'`
    posted entries in range — mirrors `getProfitAndLoss`'s own delta-
    summing technique (this file's one narrow extension of it, not a
    reimplementation of a different rule), scoped to cash actually
    collected rather than revenue recognized. */
export async function cashCollected(
  organizationId: string,
  filters: { fromDate?: string; toDate?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<number> {
  const { fromDate, toDate } = { ...defaultDateRange(), ...filters };
  const undepositedFunds = await getAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, dataAdapterMode);
  if (!undepositedFunds) return 0;
  const entries = (await listJournalEntriesForOrganization(organizationId, dataAdapterMode, { fromDate, toDate })).filter(
    (e) => e.status === 'posted' && e.sourceType === 'payment',
  );
  let total = 0;
  for (const entry of entries) {
    const withLines = await getJournalEntryWithLines(organizationId, entry.id, dataAdapterMode);
    if (!withLines) continue;
    for (const line of withLines.lines) {
      if (line.accountId !== undepositedFunds.id) continue;
      total += line.direction === 'debit' ? line.amount : -line.amount;
    }
  }
  return total;
}

export async function averageRevenuePerCase(
  organizationId: string,
  filters: { fromDate?: string; toDate?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<number> {
  const { fromDate, toDate } = { ...defaultDateRange(), ...filters };
  const [gross, activeOrders] = await Promise.all([
    grossRevenue(organizationId, { fromDate, toDate }, dataAdapterMode),
    listActiveCaseOrdersForOrganization(organizationId, dataAdapterMode),
  ]);
  const distinctCases = new Set(activeOrders.filter((o) => o.createdAt >= fromDate && o.createdAt <= toDate).map((o) => o.caseId));
  if (distinctCases.size === 0) return 0;
  return Math.round((gross / distinctCases.size) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Staff metrics
// ---------------------------------------------------------------------------

export type StaffWorkloadRow = { staffProfileId: string; name: string; activeCaseCount: number; openTaskCount: number };

export async function staffWorkload(
  organizationId: string,
  filters: { staffProfileId?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<StaffWorkloadRow[]> {
  const [views, staffList, tasks] = await Promise.all([
    loadCaseViewModels(organizationId, dataAdapterMode),
    staffProfileService.list(organizationId, dataAdapterMode),
    tasksService.listForOrganization(organizationId, dataAdapterMode),
  ]);
  const targets = filters.staffProfileId ? staffList.filter((s: StaffProfile) => s.id === filters.staffProfileId) : staffList;
  const caseWorkload = computeStaffWorkload(views, targets);
  return caseWorkload.map((row) => ({
    staffProfileId: row.staffId,
    name: row.name,
    activeCaseCount: row.activeCaseCount,
    openTaskCount: tasks.filter((t) => !t.isDone && t.assigneeStaffId === row.staffId).length,
  }));
}

export type StaffAppointmentLoadRow = { staffProfileId: string; name: string; appointmentCount: number };

export async function staffAppointmentLoad(
  organizationId: string,
  filters: { staffProfileId?: string; fromDate?: string; toDate?: string } = {},
  dataAdapterMode: DataAdapterMode = 'mock',
): Promise<StaffAppointmentLoadRow[]> {
  const { fromDate, toDate } = { ...defaultDateRange(), ...filters };
  const [staffList, appointments] = await Promise.all([
    staffProfileService.list(organizationId, dataAdapterMode),
    listAppointments(organizationId, { from: fromDate, to: toDate }, dataAdapterMode),
  ]);
  const targets = filters.staffProfileId ? staffList.filter((s) => s.id === filters.staffProfileId) : staffList;
  return targets.map((staff) => ({
    staffProfileId: staff.id,
    name: staff.displayName,
    appointmentCount: appointments.filter((a) => a.ownerStaffProfileId === staff.id).length,
  }));
}

// ---------------------------------------------------------------------------
// AR aging summary — thin wrapper around financialReportsService.getArAgingReport,
// bucketed for the ar.total/ar.aging.* metrics. Never recomputes aging math
// (domain/ledger/agingBuckets.ts) or the AR balance itself.
// ---------------------------------------------------------------------------

export type ArAgingSummary = { total: number; current: number; days31to60: number; days61to90: number; days90Plus: number };

export async function arAgingSummary(organizationId: string, dataAdapterMode: DataAdapterMode = 'mock'): Promise<ArAgingSummary> {
  const accountsReceivable = await getAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, dataAdapterMode);
  if (!accountsReceivable) return { total: 0, current: 0, days31to60: 0, days61to90: 0, days90Plus: 0 };
  const report = await getArAgingReport(organizationId, accountsReceivable.id, dataAdapterMode);
  const sumBucket = (bucket: '0-30' | '31-60' | '61-90' | '90+') => report.rows.filter((r) => r.bucket === bucket).reduce((sum, r) => sum + r.balanceDue, 0);
  return {
    total: report.totalOutstanding,
    current: sumBucket('0-30'),
    days31to60: sumBucket('31-60'),
    days61to90: sumBucket('61-90'),
    days90Plus: sumBucket('90+'),
  };
}

// ---------------------------------------------------------------------------
// Report runner — the one place a `reportRegistry.ts` entry is actually
// executed. Routes and `reportExportService.ts` both call this instead of
// each independently re-deriving "which function backs this metric" — the
// mapping lives in exactly one dispatch table, here.
// ---------------------------------------------------------------------------

export type ReportFilters = {
  fromDate?: string;
  toDate?: string;
  staffProfileId?: string;
  stage?: string;
  resourceId?: string;
  locationId?: string;
  /** Only meaningful for `notifications.unread`, which is per-caller, not
      an organization-wide aggregate — no report in `reportRegistry.ts`
      actually lists it as a metric today (it's dashboard-"Today"-only). */
  identityId?: string;
  /** Required for the `general-ledger` report (`getGeneralLedgerDetail`
      itself requires one account, it never scans every account at
      once) — omitting it is a caller error, not silently defaulted. */
  accountId?: string;
};

type MetricRunner = (organizationId: string, filters: ReportFilters, dataAdapterMode: DataAdapterMode) => Promise<unknown>;

const METRIC_RUNNERS: Partial<Record<MetricKey, MetricRunner>> = {
  'cases.active': (org, f, mode) => countActiveCases(org, { staffProfileId: f.staffProfileId }, mode),
  'cases.created': (org, f, mode) => countCasesCreated(org, { fromDate: f.fromDate, toDate: f.toDate }, mode),
  'cases.completed': (org, f, mode) => countCasesCompleted(org, { fromDate: f.fromDate, toDate: f.toDate }, mode),
  'cases.average_cycle_days': (org, f, mode) => averageCaseCycleDays(org, { fromDate: f.fromDate, toDate: f.toDate }, mode),
  'cases.overdue': (org, f, mode) => countOverdueCases(org, { stage: f.stage, staffProfileId: f.staffProfileId }, mode),
  'cases.stage.count': (org, _f, mode) => caseCountsByStage(org, mode),
  'cases.stage.average_days': (org, _f, mode) => averageDaysInStageSnapshot(org, mode),
  'cases.veteran_status': (org, _f, mode) => veteranCaseStatusBreakdown(org, mode),
  'tasks.open': (org, f, mode) => countOpenTasks(org, { staffProfileId: f.staffProfileId }, mode),
  'tasks.overdue': (org, f, mode) => countOverdueTasks(org, { staffProfileId: f.staffProfileId }, mode),
  'appointments.upcoming': (org, f, mode) => countUpcomingAppointments(org, { fromDate: f.fromDate, toDate: f.toDate, staffProfileId: f.staffProfileId, locationId: f.locationId }, mode),
  'appointments.completed': (org, f, mode) => countAppointmentsByStatus(org, 'completed', { fromDate: f.fromDate, toDate: f.toDate }, mode),
  'appointments.no_show': (org, f, mode) => countAppointmentsByStatus(org, 'no_show', { fromDate: f.fromDate, toDate: f.toDate }, mode),
  'resource.utilization': (org, f, mode) => resourceBookedHours(org, { fromDate: f.fromDate, toDate: f.toDate, resourceId: f.resourceId }, mode),
  'revenue.gross': (org, f, mode) => grossRevenue(org, { fromDate: f.fromDate, toDate: f.toDate }, mode),
  'revenue.collected': (org, f, mode) => cashCollected(org, { fromDate: f.fromDate, toDate: f.toDate }, mode),
  'revenue.average_per_case': (org, f, mode) => averageRevenuePerCase(org, { fromDate: f.fromDate, toDate: f.toDate }, mode),
  'ar.total': (org, _f, mode) => arAgingSummary(org, mode).then((s) => s.total),
  'ar.aging.current': (org, _f, mode) => arAgingSummary(org, mode).then((s) => s.current),
  'ar.aging.30': (org, _f, mode) => arAgingSummary(org, mode).then((s) => s.days31to60),
  'ar.aging.60': (org, _f, mode) => arAgingSummary(org, mode).then((s) => s.days61to90),
  'ar.aging.90_plus': (org, _f, mode) => arAgingSummary(org, mode).then((s) => s.days90Plus),
  'payments.pending': (org, f, mode) => countPaymentsByStatus(org, 'pending', { fromDate: f.fromDate, toDate: f.toDate }, mode),
  'payments.failed': (org, f, mode) => countPaymentsByStatus(org, 'failed', { fromDate: f.fromDate, toDate: f.toDate }, mode),
  'documents.generated': (org, f, mode) => countDocumentsGenerated(org, { fromDate: f.fromDate, toDate: f.toDate }, mode),
  'signatures.pending': (org, _f, mode) => countOutstandingSignatures(org, mode),
  'signatures.completion_time_avg_hours': (org, f, mode) => averageSignatureCompletionHours(org, { fromDate: f.fromDate, toDate: f.toDate }, mode),
  'notifications.unread': (org, f, mode) => (f.identityId ? getUnreadCount(org, f.identityId, mode) : Promise.resolve(0)),
  'staff.active_case_count': (org, f, mode) => staffWorkload(org, { staffProfileId: f.staffProfileId }, mode),
  'staff.open_task_count': (org, f, mode) => staffWorkload(org, { staffProfileId: f.staffProfileId }, mode),
  'staff.appointment_load': (org, f, mode) => staffAppointmentLoad(org, { staffProfileId: f.staffProfileId, fromDate: f.fromDate, toDate: f.toDate }, mode),

  // Phase 35 (Merchandise, Inventory & Commerce). Financial metrics derive
  // from the ledger; inventory metrics from the authoritative balances.
  'merchandise.revenue': (org, _f, mode) => merchandiseRevenue(org, mode),
  'merchandise.cogs': (org, _f, mode) => merchandiseCogs(org, mode),
  'merchandise.gross_margin': (org, _f, mode) => merchandiseGrossMargin(org, mode),
  'inventory.asset_value': (org, _f, mode) => inventoryAssetValue(org, mode),
  'inventory.on_hand_units': (org, _f, mode) => inventoryOnHandUnits(org, mode),
  'inventory.low_stock_count': (org, _f, mode) => lowStockProductCount(org, mode),
};

export class ReportRunnerError extends Error {}

export type MetricResult = { metricKey: MetricKey; displayName: string; value: unknown };

export type ReportRunResult =
  | { reportKey: ReportKey; displayName: string; kind: 'metrics'; metrics: MetricResult[] }
  | { reportKey: ReportKey; displayName: string; kind: 'financial'; financialReportKey: string; data: unknown };

/** Executes a `reportRegistry.ts` entry — the only place that happens.
    Routes call this and return the result verbatim; they never compute a
    metric or reimplement a financial report themselves. */
export async function runReport(organizationId: string, reportKey: string, filters: ReportFilters, dataAdapterMode: DataAdapterMode = 'mock'): Promise<ReportRunResult> {
  const definition = getReportDefinition(reportKey);
  if (!definition) throw new ReportRunnerError(`Unknown report key "${reportKey}".`);
  const { fromDate, toDate } = { ...defaultDateRange(), ...filters };

  if (definition.financialReportKey) {
    const data = await runFinancialReport(organizationId, definition.financialReportKey, { ...filters, fromDate, toDate }, dataAdapterMode);
    return { reportKey: definition.key as ReportKey, displayName: definition.displayName, kind: 'financial', financialReportKey: definition.financialReportKey, data };
  }

  const metrics = await Promise.all(
    definition.metrics.map(async (metricKey): Promise<MetricResult> => {
      const runner = METRIC_RUNNERS[metricKey];
      if (!runner) throw new ReportRunnerError(`No metric runner registered for "${metricKey}".`);
      const value = await runner(organizationId, { ...filters, fromDate, toDate }, dataAdapterMode);
      return { metricKey, displayName: getMetricDefinition(metricKey)?.displayName ?? metricKey, value };
    }),
  );
  return { reportKey: definition.key as ReportKey, displayName: definition.displayName, kind: 'metrics', metrics };
}

/** A single metric value, outside of any report — backs drill-down cards
    and ad hoc dashboard widgets. Uses the exact same `METRIC_RUNNERS`
    dispatch table `runReport` uses; never a second calculation path. */
export async function runSingleMetric(organizationId: string, metricKey: string, filters: ReportFilters, dataAdapterMode: DataAdapterMode = 'mock'): Promise<unknown> {
  if (!getMetricDefinition(metricKey)) throw new ReportRunnerError(`Unknown metric key "${metricKey}".`);
  const runner = METRIC_RUNNERS[metricKey as MetricKey];
  if (!runner) throw new ReportRunnerError(`No metric runner registered for "${metricKey}".`);
  const { fromDate, toDate } = { ...defaultDateRange(), ...filters };
  return runner(organizationId, { ...filters, fromDate, toDate }, dataAdapterMode);
}

async function runFinancialReport(
  organizationId: string,
  financialReportKey: NonNullable<ReturnType<typeof getReportDefinition>>['financialReportKey'],
  filters: ReportFilters,
  dataAdapterMode: DataAdapterMode,
): Promise<unknown> {
  switch (financialReportKey) {
    case 'trialBalance':
      return getTrialBalance(organizationId, dataAdapterMode, filters.toDate);
    case 'balanceSheet':
      return getBalanceSheet(organizationId, dataAdapterMode, filters.toDate);
    case 'profitAndLoss':
      return getProfitAndLoss(organizationId, dataAdapterMode, { fromDate: filters.fromDate, toDate: filters.toDate });
    case 'transactionRegister':
      return getTransactionRegister(organizationId, dataAdapterMode, { fromDate: filters.fromDate, toDate: filters.toDate });
    case 'arAging': {
      const accountsReceivable = await getAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, dataAdapterMode);
      if (!accountsReceivable) return { rows: [], totalOutstanding: 0, glAccountsReceivableBalance: 0, reconciles: true };
      return getArAgingReport(organizationId, accountsReceivable.id, dataAdapterMode, filters.toDate);
    }
    case 'generalLedgerDetail': {
      if (!filters.accountId) throw new ReportRunnerError('The general-ledger report requires an accountId filter.');
      return getGeneralLedgerDetail(organizationId, filters.accountId, dataAdapterMode, { fromDate: filters.fromDate, toDate: filters.toDate });
    }
    default:
      throw new ReportRunnerError(`Unhandled financialReportKey "${financialReportKey}".`);
  }
}
