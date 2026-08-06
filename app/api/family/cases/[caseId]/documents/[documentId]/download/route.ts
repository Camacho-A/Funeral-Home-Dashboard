import { NextResponse } from 'next/server';
import { requireFamilyAccess } from '@/lib/auth/requireFamilyAccess';
import { downloadFamilyDocument, PortalDocumentServiceError } from '@/services/portal/portalDocumentService';

/**
 * Phase 29 (Family Portal & External Collaboration). Requires
 * `document.download`. The browser never sees a storage URL of any kind
 * — mirrors the staff-side download route's own streaming pattern
 * exactly. Records `portal.document.viewed` with the real `portalUserId`
 * (see `portalDocumentService.ts`'s own comment).
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string; documentId: string }> }) {
  const { caseId, documentId } = await params;
  const accessResult = await requireFamilyAccess(caseId, 'document.download');
  if (!accessResult.authorized) return accessResult.response;

  try {
    const { buffer, contentType, fileName } = await downloadFamilyDocument(
      accessResult.organizationId,
      accessResult.caseId,
      documentId,
      accessResult.portalUser.id,
      accessResult.dataAdapterMode,
    );
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
      },
    });
  } catch (error) {
    if (error instanceof PortalDocumentServiceError) {
      return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
    }
    throw error;
  }
}
