import { NextResponse } from 'next/server';
import { requireFamilyAccess } from '@/lib/auth/requireFamilyAccess';
import { listFamilyVisibleDocuments } from '@/services/portal/portalDocumentService';

/** Phase 29 (Family Portal & External Collaboration). Requires
    `document.read`. Only documents that are both `familyVisible: true`
    and `status: 'active'` ever appear — see
    `portalDocumentService.ts`'s own fail-closed filter. */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const accessResult = await requireFamilyAccess(caseId, 'document.read');
  if (!accessResult.authorized) return accessResult.response;

  const documents = await listFamilyVisibleDocuments(accessResult.organizationId, accessResult.caseId, accessResult.dataAdapterMode);
  return NextResponse.json({ documents });
}
