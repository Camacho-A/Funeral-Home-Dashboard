import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canViewDocument } from '@/services/authorizationPolicyService';
import { downloadFile, DocumentServiceError } from '@/services/documentService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 25 (Document Generation & Template Management). The only path
 * that ever touches document storage bytes — re-checks organization
 * membership and `document.view` on every single call (never a cached or
 * bookmarked link's own authority), then streams the bytes back directly.
 * The browser never sees a Vercel Blob URL of any kind (see
 * `lib/documentStorageProvider.ts`'s header comment) — this satisfies
 * "secure downloads"/"non-public file URLs" more strongly than a
 * short-lived signed URL would, since there is no token to leak at all.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string; documentId: string }> }) {
  const { caseId, documentId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canViewDocument({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view documents for this case.' }, { status: 403 });
  }

  try {
    const { buffer, contentType, fileName } = await downloadFile(
      organizationId,
      caseId,
      documentId,
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      dataAdapterMode,
    );
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
      },
    });
  } catch (error) {
    if (error instanceof DocumentServiceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
