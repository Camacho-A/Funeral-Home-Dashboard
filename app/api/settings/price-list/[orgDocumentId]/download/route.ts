import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canViewDocument } from '@/services/authorizationPolicyService';
import { getOrgDocument } from '@/services/orgDocumentService';
import { downloadOrgDocumentBytes } from '@/services/documentService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 39 (Family Billing & FTC Compliance). Streams a General Price List
 * PDF's bytes. Re-checks authorization every request (`document.view`); the
 * browser never sees a storage URL. Tenant-scoped: the org document must
 * belong to the caller's authorized organization.
 */
export async function GET(request: Request, { params }: { params: Promise<{ orgDocumentId: string }> }) {
  const { orgDocumentId } = await params;
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });

  const auth = await requireAuthorizedOrganization(organizationId);
  if (!auth.authorized) return auth.response;
  const mode = getDataAdapterMode();
  if (!(await canViewDocument({ identityId: auth.context.userId, organizationId: auth.context.organizationId, roleKey: auth.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  const doc = await getOrgDocument(auth.context.organizationId, orgDocumentId, mode);
  if (!doc || doc.storageKey.length === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const { buffer, contentType } = await downloadOrgDocumentBytes(doc.storageKey);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${doc.fileName}"` },
  });
}
