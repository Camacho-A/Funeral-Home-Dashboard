import { getDataAdapterMode } from '@/lib/env';
import { runBillReminderSweep } from '@/services/accountsPayableNotifications';
import { cronHandler } from '../_lib/cronRoute';

/**
 * Phase 36 (Procurement & Accounts Payable). Vendor-bill due/overdue
 * reminder sweep — byte-for-byte the same `CRON_SECRET` bearer-check shape as
 * the Phase 33 digest and Phase 34 appointment-reminder crons, reusing the
 * same env var (no new cron secret). Fails closed: `CRON_SECRET` unset → 503;
 * missing/wrong bearer → 401. See `vercel.json`'s `crons` entry and
 * docs/adr/ADR-040-procurement-and-accounts-payable.md.
 *
 * Scheduled-job isolation (2026-10).
 * Manors keeps these routes POST-only for now: Vercel Cron sends GET, so a
 * scheduled run still gets 405 exactly as before and no previously
 * nonfunctional schedule starts running as a side effect of this port
 * (enabling GET is a separate, reviewed rollout — docs/SCHEDULED_JOBS.md).
 * POST (manual trigger) uses one constant-time
 * `CRON_SECRET` bearer check (`app/api/cron/_lib/cronRoute.ts`); the sweep
 * only ever processes this deployment's organizations
 * (`DEPLOYMENT_ORGANIZATION_IDS`). `vercel.json` is unchanged by this port.
 */
export const POST = cronHandler(() => runBillReminderSweep(new Date().toISOString(), getDataAdapterMode()));

