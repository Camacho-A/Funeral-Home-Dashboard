import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadSchedule } from '@/services/authorizationPolicyService';
import { getAvailability } from '@/services/resourceService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 27 (Scheduling & Resource Management). Backs `AppointmentDialog`'s
 * live conflict indicator — returns raw booked windows only; hard-vs-soft
 * conflict classification is `services/scheduling/conflictEngine.ts`'s
 * job (exercised through `POST /api/scheduling/appointments`'s own
 * validation, not here) — this route is a read-only availability check.
 */
export async function GET(request: Request, { params }: { params: Promise<{ resourceId: string }> }) {
  const { resourceId } = await params;
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (!from || !to) return NextResponse.json({ error: 'from and to are required.' }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReadSchedule({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view resource availability for this organization.' }, { status: 403 });
  }

  const availability = await getAvailability(organizationId, resourceId, from, to, dataAdapterMode);
  return NextResponse.json(availability);
}
