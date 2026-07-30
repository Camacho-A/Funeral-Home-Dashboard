import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageDocumentTemplate } from '@/services/authorizationPolicyService';
import { restoreTemplate, DocumentTemplateServiceError } from '@/services/documentTemplatesService';

export async function POST(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { templateId } = await params;
  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, b.organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canManageDocumentTemplate({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage document templates for this organization.' }, { status: 403 });
  }

  try {
    await restoreTemplate(
      authz.context.organizationId,
      templateId,
      { organizationId: authz.context.organizationId, actorIdentityId: identity.id, actorMembershipId: null, actorRoleKey: authz.context.role, correlationId: crypto.randomUUID() },
      dataAdapterMode,
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof DocumentTemplateServiceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
