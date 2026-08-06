import { NextResponse } from 'next/server';
import { requireFamilyAccess } from '@/lib/auth/requireFamilyAccess';
import { listFamilyAppointments } from '@/services/portal/portalSchedulingView';

/** Phase 29 (Family Portal & External Collaboration). Requires
    `appointment.read`. Read-only — no rescheduling capability exists
    anywhere on the family side (refinement #15). */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const accessResult = await requireFamilyAccess(caseId, 'appointment.read');
  if (!accessResult.authorized) return accessResult.response;

  const appointments = await listFamilyAppointments(accessResult.organizationId, accessResult.caseId, accessResult.dataAdapterMode);
  return NextResponse.json({ appointments });
}
