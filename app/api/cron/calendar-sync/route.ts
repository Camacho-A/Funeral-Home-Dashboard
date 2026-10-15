import { getDataAdapterMode } from '@/lib/env';
import { runCalendarSyncSweep } from '@/services/calendarSyncService';
import { cronHandler } from '../_lib/cronRoute';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). The third cron-triggered Route Handler in this codebase
 * — byte-for-byte the same `CRON_SECRET` bearer-check shape as
 * `app/api/cron/appointment-reminders/route.ts`/
 * `app/api/cron/notification-digest/route.ts`, reusing the same env
 * var rather than introducing a third cron secret. See `vercel.json`'s
 * own `crons` entry (every 15 minutes, matching the other two crons'
 * cadence) and
 * `docs/adr/ADR-038-scheduling-integrations-calendar-sync-and-reminders.md`.
 *
 * Fails closed exactly like the other cron routes: `CRON_SECRET` unset
 * means this route can never be triggered (503), and a missing/wrong
 * bearer token is rejected (401) — never a silently-accepted
 * unauthenticated sweep. This is the only route in the codebase that
 * ever calls Google/Microsoft's calendar API — see
 * `calendarSyncService.ts`'s own header comment for why every
 * appointment-mutating route stays synchronous-Wix-write-only.
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
export const POST = cronHandler(() => runCalendarSyncSweep(getDataAdapterMode()));

