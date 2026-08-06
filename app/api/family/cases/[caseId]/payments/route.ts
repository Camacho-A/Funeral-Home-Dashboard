import { NextResponse } from 'next/server';
import { requireFamilyAccess } from '@/lib/auth/requireFamilyAccess';
import { listFamilyPaymentHistory } from '@/services/portal/portalPaymentService';

/** Phase 29 (Family Portal & External Collaboration). Requires
    `payment.read`. Read-only history — no accounting tools, matching
    the plan's own scope boundary. */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const accessResult = await requireFamilyAccess(caseId, 'payment.read');
  if (!accessResult.authorized) return accessResult.response;

  const payments = await listFamilyPaymentHistory(accessResult.organizationId, accessResult.caseId, accessResult.dataAdapterMode);
  return NextResponse.json({ payments });
}
