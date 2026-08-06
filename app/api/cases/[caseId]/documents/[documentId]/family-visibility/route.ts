import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManagePortal } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { setFamilyVisible, DocumentServiceError } from '@/services/documentService';

/**
 * Phase 29 (Family Portal & External Collaboration). The **only** route
 * that can ever flip `CaseDocument.familyVisible` — gated by
 * `portal.manage`, distinct from `document.view`/`document.generate`
 * (a staff member can view/generate a document without being able to
 * decide whether a family member may see it). See
 * `services/documentService.ts`'s `setFamilyVisible` for the fail-closed
 * default this is the sole exception to.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ caseId: string; documentId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { caseId, documentId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; familyVisible?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof b.familyVisible !== 'boolean') {
    return NextResponse.json({ error: 'familyVisible must be a boolean.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canManagePortal({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage Family Portal document visibility for this case.' }, { status: 403 });
  }

  try {
    const document = await setFamilyVisible(organizationId, caseId, documentId, b.familyVisible, dataAdapterMode);
    return NextResponse.json({ document });
  } catch (error) {
    if (error instanceof DocumentServiceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
