import { getDataAdapterMode } from '@/lib/env';
import { runNotificationDigestSweep } from '@/services/notificationDigestService';
import { cronHandler } from '../_lib/cronRoute';

/**
 * Phase 33 (Real Notification Delivery). The one cron-triggered Route
 * Handler behind digest batching and quiet-hours deferral — see
 * `vercel.json`'s own `crons` entry (every 15 minutes) and
 * `docs/adr/ADR-037-real-notification-delivery.md`'s "Finding" section
 * for why this exists at all.
 *
 * Vercel signs every cron-triggered request with a bearer token matching
 * `CRON_SECRET` (Vercel's own documented convention,
 * vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs) — this
 * route rejects anything else, including an unauthenticated request or
 * one bearing the wrong secret. `CRON_SECRET` unset entirely means this
 * route can never be triggered, mirroring every other "no real provider
 * configured" gate this phase introduced (`RESEND_API_KEY`/`TWILIO_*`) —
 * failing closed, never accepting an unauthenticated sweep trigger just
 * because the operator hasn't set the secret yet.
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
export const POST = cronHandler(() => runNotificationDigestSweep(getDataAdapterMode()));

