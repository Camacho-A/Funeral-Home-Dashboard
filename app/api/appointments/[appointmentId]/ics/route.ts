import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadSchedule } from '@/services/authorizationPolicyService';
import { getAppointment } from '@/services/schedulingService';
import { resolveLocationText } from '@/services/scheduling/appointmentLocationText';
import { buildSingleEventIcs } from '@/lib/icsService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Single-event ICS download, staff-authenticated — gated
 * by `schedule.read`, the same permission that gates viewing the
 * appointment itself. May include `DESCRIPTION` from `Appointment.notes`
 * — the staff path only, never the family path (see the family route's
 * own comment).
 */
export async function GET(request: Request, { params }: { params: Promise<{ appointmentId: string }> }) {
  const { appointmentId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReadSchedule({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view this appointment.' }, { status: 403 });
  }

  const appointment = await getAppointment(organizationId, appointmentId, dataAdapterMode);
  if (!appointment) return NextResponse.json({ error: 'Appointment not found.' }, { status: 404 });

  const location = await resolveLocationText(organizationId, appointment.locationId, dataAdapterMode);
  const ics = buildSingleEventIcs('Beacon', {
    appointmentId: appointment.id,
    title: appointment.title,
    description: appointment.notes,
    location,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    status: appointment.status === 'cancelled' ? 'cancelled' : 'confirmed',
    createdAt: appointment.createdAt,
    updatedAt: appointment.updatedAt,
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="appointment-${appointment.id}.ics"`,
    },
  });
}
