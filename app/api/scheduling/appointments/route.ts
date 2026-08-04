import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadSchedule, canCreateAppointment, canManageResources } from '@/services/authorizationPolicyService';
import { listAppointments, createAppointment, SchedulingServiceError } from '@/services/schedulingService';
import { isValidAppointmentTypeKey } from '@/domain/scheduling/appointmentTypeRegistry';
import { getDataAdapterMode } from '@/lib/env';
import type { AppointmentStatus } from '@/types/appointment';

const VALID_STATUSES: readonly string[] = ['draft', 'scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];

/**
 * Phase 27 (Scheduling & Resource Management). Dual-mode
 * `requireAuthorizedOrganization`, matching every other scheduling route
 * — reachable from both the universal Case Detail page's Schedule tab
 * and the org-wide Calendar page. Delegates entirely to
 * `services/schedulingService.ts`; no conflict logic, recurrence logic,
 * or activity recording lives here.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReadSchedule({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view the schedule for this organization.' }, { status: 403 });
  }

  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;
  const caseId = url.searchParams.get('caseId') ?? undefined;
  const resourceId = url.searchParams.get('resourceId') ?? undefined;
  const statusParam = url.searchParams.get('status');
  const status = statusParam && VALID_STATUSES.includes(statusParam) ? (statusParam as AppointmentStatus) : undefined;

  const appointments = await listAppointments(organizationId, { from, to, caseId, resourceId, status }, dataAdapterMode);
  return NextResponse.json({ appointments });
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as {
    organizationId?: unknown;
    caseId?: unknown;
    appointmentType?: unknown;
    title?: unknown;
    notes?: unknown;
    locationId?: unknown;
    startAt?: unknown;
    endAt?: unknown;
    timezone?: unknown;
    resourceIds?: unknown;
    saveAsDraft?: unknown;
    recurrence?: unknown;
    override?: unknown;
  };

  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (typeof b.appointmentType !== 'string' || !isValidAppointmentTypeKey(b.appointmentType)) {
    return NextResponse.json({ error: 'A valid appointmentType is required.' }, { status: 400 });
  }
  if (typeof b.title !== 'string' || !b.title.trim()) return NextResponse.json({ error: 'title is required.' }, { status: 400 });
  if (typeof b.startAt !== 'string' || typeof b.endAt !== 'string') return NextResponse.json({ error: 'startAt and endAt are required.' }, { status: 400 });
  if (typeof b.timezone !== 'string' || !b.timezone.trim()) return NextResponse.json({ error: 'timezone is required.' }, { status: 400 });
  if (b.resourceIds !== undefined && !Array.isArray(b.resourceIds)) return NextResponse.json({ error: 'resourceIds must be an array if provided.' }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canCreateAppointment({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to create appointments for this organization.' }, { status: 403 });
  }

  let override: { reason: string } | undefined;
  if (b.override && typeof b.override === 'object' && 'reason' in b.override && typeof (b.override as { reason: unknown }).reason === 'string') {
    if (!(await canManageResources({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
      return NextResponse.json({ error: 'Not authorized to override a scheduling conflict.' }, { status: 403 });
    }
    override = { reason: (b.override as { reason: string }).reason };
  }

  try {
    const appointment = await createAppointment(
      {
        caseId: typeof b.caseId === 'string' ? b.caseId : undefined,
        appointmentType: b.appointmentType,
        title: b.title,
        notes: typeof b.notes === 'string' ? b.notes : undefined,
        locationId: typeof b.locationId === 'string' ? b.locationId : undefined,
        startAt: b.startAt,
        endAt: b.endAt,
        timezone: b.timezone,
        resourceIds: (b.resourceIds as string[] | undefined) ?? undefined,
        saveAsDraft: b.saveAsDraft === true,
        recurrence: b.recurrence as never,
        override,
        idFactory: () => crypto.randomUUID(),
      },
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      dataAdapterMode,
    );
    return NextResponse.json({ appointment }, { status: 201 });
  } catch (error) {
    if (error instanceof SchedulingServiceError) {
      return NextResponse.json({ error: error.message, conflicts: error.hardConflicts ?? undefined }, { status: error.hardConflicts?.length ? 409 : 422 });
    }
    throw error;
  }
}
