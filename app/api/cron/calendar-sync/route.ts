import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { runCalendarSyncSweep } from '@/services/calendarSyncService';

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
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 });
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const dataAdapterMode = getDataAdapterMode();
  const result = await runCalendarSyncSweep(dataAdapterMode);
  return NextResponse.json({ result });
}
