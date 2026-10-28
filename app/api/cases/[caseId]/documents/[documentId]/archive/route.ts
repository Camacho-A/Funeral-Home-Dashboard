import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canArchiveDocument, canManageOrganization } from '@/services/authorizationPolicyService';
import { isDocumentArchivingAdministratorsOnly, parseDocumentRemoval, type DocumentRemoval } from '@/domain/organization/documentArchiveCapability';
import { archive, DocumentServiceError } from '@/services/documentService';
import { getDataAdapterMode } from '@/lib/env';

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string; documentId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { caseId, documentId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; reason?: unknown; note?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canArchiveDocument({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to archive documents for this case.' }, { status: 403 });
  }

  // 2026-10: where archiving is the administrators-only "Remove" (Manors),
  // only an administrator may remove a document, and always with a reason.
  let removal: DocumentRemoval | null = null;
  if (isDocumentArchivingAdministratorsOnly(organizationId)) {
    if (!(await canManageOrganization({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
      return NextResponse.json({ error: 'Only an administrator can remove a document.' }, { status: 403 });
    }
    const parsed = parseDocumentRemoval(b);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    removal = parsed;
  }

  try {
    await archive(
      organizationId,
      caseId,
      documentId,
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      dataAdapterMode,
      removal,
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof DocumentServiceError) {
      // Handwritten item #12 (2026-09). Mirrors the signature-request
      // route's own convention (app/api/cases/[caseId]/documents/[documentId]/
      // signature-requests/route.ts): "not found" maps to 404, every other
      // service-thrown rejection (including "archiving is not enabled for
      // this organization") maps to 422 — never a raw 404 for a capability
      // rejection, and never leaking which organization or why beyond the
      // service's own safe message.
      return NextResponse.json({ error: error.message }, { status: error.message.includes('not found') ? 404 : 422 });
    }
    throw error;
  }
}
