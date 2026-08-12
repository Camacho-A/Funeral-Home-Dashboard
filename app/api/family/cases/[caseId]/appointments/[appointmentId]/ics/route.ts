import { NextResponse } from 'next/server';
import { requireFamilyAccess } from '@/lib/auth/requireFamilyAccess';
import { listFamilyAppointments } from '@/services/portal/portalSchedulingView';
import { resolveLocationText } from '@/services/scheduling/appointmentLocationText';
import { buildSingleEventIcs } from '@/lib/icsService';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Family-side single-event ICS download — requires
 * `appointment.read` via `requireFamilyAccess`, matching the existing
 * family appointments list route exactly. Built from
 * `listFamilyAppointments`'s `PortalAppointmentView` — the same
 * allowlisting DTO the family appointments list already uses, so
 * `Appointment.notes` never reaches this route at all (never passed as
 * `description`, matching the staff/family DTO split established
 * throughout Phase 29/34). Looks the target appointment up within the
 * already-case-scoped list rather than a separate `getAppointment` call,
 * so a family member can never probe another case's appointment by
 * guessing an id.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string; appointmentId: string }> }) {
  const { caseId, appointmentId } = await params;
  const accessResult = await requireFamilyAccess(caseId, 'appointment.read');
  if (!accessResult.authorized) return accessResult.response;

  const appointments = await listFamilyAppointments(accessResult.organizationId, accessResult.caseId, accessResult.dataAdapterMode);
  const appointment = appointments.find((a) => a.id === appointmentId);
  if (!appointment) return NextResponse.json({ error: 'Appointment not found.' }, { status: 404 });

  const location = await resolveLocationText(accessResult.organizationId, appointment.locationId, accessResult.dataAdapterMode);
  const ics = buildSingleEventIcs('Beacon', {
    appointmentId: appointment.id,
    title: appointment.title,
    description: null,
    location,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    status: appointment.status === 'cancelled' ? 'cancelled' : 'confirmed',
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="appointment-${appointment.id}.ics"`,
    },
  });
}
