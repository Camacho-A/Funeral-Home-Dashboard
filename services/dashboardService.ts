import type { DataAdapterMode } from '../lib/env';
import { getUnreadCount } from './notificationService';
import {
  defaultDateRange,
  countActiveCases,
  countOverdueCases,
  countOpenTasks,
  countOverdueTasks,
  countUpcomingAppointments,
  grossRevenue,
  cashCollected,
  arAgingSummary,
  countOutstandingSignatures,
  countPaymentsByStatus,
} from './reportingService';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). Composes
 * `reportingService.ts` + `notificationService.ts` into the dashboard's
 * four sections — never computes a metric itself. Sections are
 * permission-gated at render time, not per-user layouts: a caller
 * lacking a section's permission gets `null` for that section (computed
 * nothing, not computed-then-hidden), per this phase's own "do not
 * hardcode role-specific dashboard layouts, use permissions" rule.
 * `today` needs no permission at all — every authenticated member reads
 * their own unread-notification count, the same way every member reads
 * their own session.
 */

export type DashboardTodaySection = { unreadNotifications: number; appointmentsToday: number };
export type DashboardOperationsSection = { activeCases: number; overdueCases: number; openTasks: number; overdueTasks: number; upcomingAppointments: number };
export type DashboardFinancialSection = { grossRevenue: number; cashCollected: number; accountsReceivableTotal: number };
export type DashboardAttentionSection = { overdueCases: number; overdueTasks: number; outstandingSignatures: number; failedPayments: number };

export type DashboardResult = {
  today: DashboardTodaySection;
  operations: DashboardOperationsSection | null;
  financial: DashboardFinancialSection | null;
  attention: DashboardAttentionSection | null;
};

export type DashboardPermissions = {
  canViewOperational: boolean;
  canViewFinancial: boolean;
};

function startAndEndOfToday(now: string): { fromDate: string; toDate: string } {
  const date = new Date(now);
  const fromDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
  const toDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
  return { fromDate, toDate };
}

export async function getDashboard(
  organizationId: string,
  caller: { identityId: string; permissions: DashboardPermissions },
  dataAdapterMode: DataAdapterMode = 'mock',
  now: string = new Date().toISOString(),
): Promise<DashboardResult> {
  const { fromDate: todayStart, toDate: todayEnd } = startAndEndOfToday(now);
  const range = defaultDateRange(now);

  /**
   * One wave, not four (2026-10 performance pass).
   *
   * Every count below is independent — none feeds another — but they used
   * to run in four sequential Promise.all groups: today, then operations,
   * then the failed-payment count, then financials. Against Wix each wave
   * costs a full round trip, which is why this endpoint measured ~6s in
   * production and the dashboard showed zeros for that whole window.
   *
   * Firing them together makes the endpoint cost one round trip instead
   * of four. Permission gating is unchanged and still decides what is
   * REQUESTED: a caller without the operational or financial permission
   * runs none of those queries (`null` below), exactly as before — this
   * reorders work, it never widens who can see what.
   */
  const operational = caller.permissions.canViewOperational;
  const fin = caller.permissions.canViewFinancial;

  const [
    unreadNotifications,
    appointmentsToday,
    activeCases,
    overdueCases,
    openTasks,
    overdueTasks,
    upcomingAppointments,
    outstandingSignatures,
    failedPayments,
    gross,
    collected,
    arSummary,
  ] = await Promise.all([
    getUnreadCount(organizationId, caller.identityId, dataAdapterMode),
    countUpcomingAppointments(organizationId, { fromDate: todayStart, toDate: todayEnd }, dataAdapterMode),
    operational ? countActiveCases(organizationId, {}, dataAdapterMode) : Promise.resolve(0),
    operational ? countOverdueCases(organizationId, {}, dataAdapterMode) : Promise.resolve(0),
    operational ? countOpenTasks(organizationId, {}, dataAdapterMode) : Promise.resolve(0),
    operational ? countOverdueTasks(organizationId, {}, dataAdapterMode) : Promise.resolve(0),
    operational ? countUpcomingAppointments(organizationId, { ...range }, dataAdapterMode) : Promise.resolve(0),
    operational ? countOutstandingSignatures(organizationId, dataAdapterMode) : Promise.resolve(0),
    operational && fin ? countPaymentsByStatus(organizationId, 'failed', { ...range }, dataAdapterMode) : Promise.resolve(0),
    fin ? grossRevenue(organizationId, { ...range }, dataAdapterMode) : Promise.resolve(0),
    fin ? cashCollected(organizationId, { ...range }, dataAdapterMode) : Promise.resolve(0),
    fin ? arAgingSummary(organizationId, dataAdapterMode) : Promise.resolve({ total: 0 }),
  ]);

  const today: DashboardTodaySection = { unreadNotifications, appointmentsToday };

  const operations: DashboardOperationsSection | null = operational
    ? { activeCases, overdueCases, openTasks, overdueTasks, upcomingAppointments }
    : null;

  const attention: DashboardAttentionSection | null = operational
    ? { overdueCases, overdueTasks, outstandingSignatures, failedPayments }
    : null;

  const financial: DashboardFinancialSection | null = fin
    ? { grossRevenue: gross, cashCollected: collected, accountsReceivableTotal: arSummary.total }
    : null;

  return { today, operations, financial, attention };
}
