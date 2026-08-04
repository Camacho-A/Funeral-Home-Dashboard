import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadSchedule, canEditAppointment, canManageResources } from '@/services/authorizationPolicyService';
import { getAppointment, listResourceAssignments, rescheduleAppointment, updateAppointmentResources, SchedulingServiceError } from '@/services/schedulingService';
import { getDataAdapterMode } from '@/lib/env';

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

  const resourceAssignments = await listResourceAssignments(organizationId, appointmentId, dataAdapterMode);
  return NextResponse.json({ appointment, resourceAssignments });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ appointmentId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { appointmentId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as {
    organizationId?: unknown;
    startAt?: unknown;
    endAt?: unknown;
    addResourceIds?: unknown;
    removeResourceIds?: unknown;
    override?: unknown;
  };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canEditAppointment({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to edit this appointment.' }, { status: 403 });
  }

  let override: { reason: string } | undefined;
  if (b.override && typeof b.override === 'object' && 'reason' in b.override && typeof (b.override as { reason: unknown }).reason === 'string') {
    if (!(await canManageResources({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
      return NextResponse.json({ error: 'Not authorized to override a scheduling conflict.' }, { status: 403 });
    }
    override = { reason: (b.override as { reason: string }).reason };
  }

  try {
    if (typeof b.startAt === 'string' && typeof b.endAt === 'string') {
      const appointment = await rescheduleAppointment(organizationId, appointmentId, { startAt: b.startAt, endAt: b.endAt }, { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() }, dataAdapterMode, override);
      return NextResponse.json({ appointment });
    }
    if (b.addResourceIds !== undefined || b.removeResourceIds !== undefined) {
      await updateAppointmentResources(
        organizationId,
        appointmentId,
        { addResourceIds: b.addResourceIds as string[] | undefined, removeResourceIds: b.removeResourceIds as string[] | undefined },
        { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
        dataAdapterMode,
        override,
      );
      const appointment = await getAppointment(organizationId, appointmentId, dataAdapterMode);
      return NextResponse.json({ appointment });
    }
    return NextResponse.json({ error: 'Nothing to update — provide startAt/endAt or addResourceIds/removeResourceIds.' }, { status: 400 });
  } catch (error) {
    if (error instanceof SchedulingServiceError) {
      return NextResponse.json({ error: error.message, conflicts: error.hardConflicts ?? undefined }, { status: error.hardConflicts?.length ? 409 : error.message.includes('not found') ? 404 : 422 });
    }
    throw error;
  }
}
