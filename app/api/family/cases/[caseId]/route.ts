import { NextResponse } from 'next/server';
import { requireFamilyAccess } from '@/lib/auth/requireFamilyAccess';
import { getFamilyCase } from '@/services/portal/portalCaseService';

/**
 * Phase 29 (Family Portal & External Collaboration). Requires
 * `case.summary.read`. `organizationId`/`caseId` are always the
 * server-derived values from `requireFamilyAccess` — never the raw
 * `caseId` route param used directly against a client-supplied org.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const accessResult = await requireFamilyAccess(caseId, 'case.summary.read');
  if (!accessResult.authorized) return accessResult.response;

  const caseView = await getFamilyCase(accessResult.organizationId, accessResult.caseId, accessResult.dataAdapterMode);
  if (!caseView) {
    return NextResponse.json({ error: 'Case not found.' }, { status: 404 });
  }
  return NextResponse.json({ case: caseView });
}
