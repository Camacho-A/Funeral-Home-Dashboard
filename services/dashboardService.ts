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

  const [unreadNotifications, appointmentsToday] = await Promise.all([
    getUnreadCount(organizationId, caller.identityId, dataAdapterMode),
    countUpcomingAppointments(organizationId, { fromDate: todayStart, toDate: todayEnd }, dataAdapterMode),
  ]);
  const today: DashboardTodaySection = { unreadNotifications, appointmentsToday };

  let operations: DashboardOperationsSection | null = null;
  let attention: DashboardAttentionSection | null = null;
  if (caller.permissions.canViewOperational) {
    const [activeCases, overdueCases, openTasks, overdueTasks, upcomingAppointments, outstandingSignatures] = await Promise.all([
      countActiveCases(organizationId, {}, dataAdapterMode),
      countOverdueCases(organizationId, {}, dataAdapterMode),
      countOpenTasks(organizationId, {}, dataAdapterMode),
      countOverdueTasks(organizationId, {}, dataAdapterMode),
      countUpcomingAppointments(organizationId, { ...range }, dataAdapterMode),
      countOutstandingSignatures(organizationId, dataAdapterMode),
    ]);
    operations = { activeCases, overdueCases, openTasks, overdueTasks, upcomingAppointments };

    let failedPayments = 0;
    if (caller.permissions.canViewFinancial) {
      failedPayments = await countPaymentsByStatus(organizationId, 'failed', { ...range }, dataAdapterMode);
    }
    attention = { overdueCases, overdueTasks, outstandingSignatures, failedPayments };
  }

  let financial: DashboardFinancialSection | null = null;
  if (caller.permissions.canViewFinancial) {
    const [gross, collected, arSummary] = await Promise.all([
      grossRevenue(organizationId, { ...range }, dataAdapterMode),
      cashCollected(organizationId, { ...range }, dataAdapterMode),
      arAgingSummary(organizationId, dataAdapterMode),
    ]);
    financial = { grossRevenue: gross, cashCollected: collected, accountsReceivableTotal: arSummary.total };
  }

  return { today, operations, financial, attention };
}
