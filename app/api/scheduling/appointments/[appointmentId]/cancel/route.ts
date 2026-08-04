import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canCancelAppointment } from '@/services/authorizationPolicyService';
import { cancelAppointment, SchedulingServiceError } from '@/services/schedulingService';
import { getDataAdapterMode } from '@/lib/env';

export async function POST(request: Request, { params }: { params: Promise<{ appointmentId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { appointmentId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; reason?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (b.reason !== undefined && typeof b.reason !== 'string') {
    return NextResponse.json({ error: 'reason must be a string if provided.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canCancelAppointment({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to cancel this appointment.' }, { status: 403 });
  }

  try {
    const appointment = await cancelAppointment(
      organizationId,
      appointmentId,
      (b.reason as string | undefined) ?? null,
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      dataAdapterMode,
    );
    return NextResponse.json({ appointment });
  } catch (error) {
    if (error instanceof SchedulingServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.message.includes('not found') ? 404 : 422 });
    }
    throw error;
  }
}
