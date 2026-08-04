import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadSchedule } from '@/services/authorizationPolicyService';
import { listAppointmentsForCase } from '@/services/schedulingService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 27 (Scheduling & Resource Management). Backs the Case Detail
 * page's Schedule tab — Upcoming/Completed/Cancelled sections are all
 * derived client-side from this one list, matching
 * `GET /api/cases/[caseId]/documents`'s own precedent (no separate
 * "history" endpoint).
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReadSchedule({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: "Not authorized to view this case's schedule." }, { status: 403 });
  }

  const appointments = await listAppointmentsForCase(organizationId, caseId, dataAdapterMode);
  return NextResponse.json({ appointments });
}
