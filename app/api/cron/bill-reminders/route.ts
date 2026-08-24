import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { runBillReminderSweep } from '@/services/accountsPayableNotifications';

/**
 * Phase 36 (Procurement & Accounts Payable). Vendor-bill due/overdue
 * reminder sweep — byte-for-byte the same `CRON_SECRET` bearer-check shape as
 * the Phase 33 digest and Phase 34 appointment-reminder crons, reusing the
 * same env var (no new cron secret). Fails closed: `CRON_SECRET` unset → 503;
 * missing/wrong bearer → 401. See `vercel.json`'s `crons` entry and
 * docs/adr/ADR-040-procurement-and-accounts-payable.md.
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
  const result = await runBillReminderSweep(new Date().toISOString(), dataAdapterMode);
  return NextResponse.json({ result });
}
