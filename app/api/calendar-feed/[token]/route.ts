import { NextResponse } from 'next/server';
import { resolveFeedToken, touchFeedTokenAccess } from '@/services/calendarFeedTokenService';
import { listAppointments } from '@/services/schedulingService';
import { resolveLocationText } from '@/services/scheduling/appointmentLocationText';
import { buildIcsCalendar, type IcsEventInput } from '@/lib/icsService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). A staff member's personal subscription feed — the ONE
 * route in this codebase meant to be pulled by an external calendar
 * client (Google Calendar, Apple Calendar, Outlook) with no Beacon
 * session at all, exactly like `/sign`'s public signing routes. The
 * token itself, resolved via `resolveFeedTokenService.ts`'s hash-at-rest
 * lookup, is the sole authenticity mechanism — no `requireSameOrigin`
 * (a GET, and genuinely cross-origin by design), no rate limiting (a
 * calendar client polls this indefinitely; rate-limiting would break
 * legitimate subscriptions, not attackers).
 *
 * `resolveFeedToken` is org-agnostic by necessity (a feed URL carries no
 * organizationId of its own) — the one call site allowed to be, mirroring
 * the cron sweeps' own documented exception; every read after resolution
 * is correctly scoped by the token's own `organizationId`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  const dataAdapterMode = getDataAdapterMode();

  const feedToken = await resolveFeedToken(rawToken, dataAdapterMode);
  if (!feedToken) {
    return NextResponse.json({ error: 'Invalid or revoked feed link.' }, { status: 404 });
  }

  const appointments = (await listAppointments(feedToken.organizationId, {}, dataAdapterMode)).filter(
    (appointment) => appointment.ownerStaffProfileId === feedToken.ownerStaffProfileId && appointment.status !== 'draft',
  );

  const events: IcsEventInput[] = await Promise.all(
    appointments.map(async (appointment) => ({
      appointmentId: appointment.id,
      title: appointment.title,
      description: appointment.notes,
      location: await resolveLocationText(feedToken.organizationId, appointment.locationId, dataAdapterMode),
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      status: appointment.status === 'cancelled' ? 'cancelled' : 'confirmed',
      createdAt: appointment.createdAt,
      updatedAt: appointment.updatedAt,
    })),
  );

  await touchFeedTokenAccess(feedToken, dataAdapterMode);

  const ics = buildIcsCalendar('Beacon Appointments', events);
  return new NextResponse(ics, { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
}
