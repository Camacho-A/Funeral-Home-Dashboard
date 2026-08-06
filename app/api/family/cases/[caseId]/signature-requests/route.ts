import { NextResponse } from 'next/server';
import { requireFamilyAccess } from '@/lib/auth/requireFamilyAccess';
import { listFamilySignatureRequests } from '@/services/portal/portalSignatureService';

/** Phase 29 (Family Portal & External Collaboration). Requires
    `signature.complete` — the one capability covering the whole
    list/complete/decline signing surface. */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const accessResult = await requireFamilyAccess(caseId, 'signature.complete');
  if (!accessResult.authorized) return accessResult.response;

  const requests = await listFamilySignatureRequests(accessResult.organizationId, accessResult.caseId, accessResult.portalUser.email, accessResult.dataAdapterMode);
  return NextResponse.json({ requests });
}
