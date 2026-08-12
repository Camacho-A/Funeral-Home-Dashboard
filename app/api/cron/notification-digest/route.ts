import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { runNotificationDigestSweep } from '@/services/notificationDigestService';

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
  const result = await runNotificationDigestSweep(dataAdapterMode);
  return NextResponse.json({ result });
}
