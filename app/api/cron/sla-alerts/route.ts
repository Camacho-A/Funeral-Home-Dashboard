import { getDataAdapterMode } from '@/lib/env';
import { runSlaAlertSweep } from '@/services/slaAlertService';
import { cronHandler } from '../_lib/cronRoute';

/**
 * SLA alerts (2026-10). The same `CRON_SECRET` bearer check and POST-only
 * shape as every other Manors scheduled job (`app/api/cron/_lib/cronRoute.ts`):
 * fails closed without the secret, and only ever processes this
 * deployment's organizations. Not added to `vercel.json` — enabling a
 * schedule is a separate, reviewed rollout (docs/SCHEDULED_JOBS.md).
 * Re-running it never repeats an alert (services/slaAlertService.ts).
 */
export const POST = cronHandler(() => runSlaAlertSweep(new Date().toISOString(), getDataAdapterMode()));
