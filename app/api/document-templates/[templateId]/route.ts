import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageDocumentTemplate } from '@/services/authorizationPolicyService';
import { createVersion, DocumentTemplateServiceError } from '@/services/documentTemplatesService';

/**
 * Phase 25 (Document Generation & Template Management). Editing a
 * template's body always creates a new version (see this phase's
 * Invariants) — never an in-place edit of a past one.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
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
  const b = body as { organizationId?: unknown; body?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof b.body !== 'string') {
    return NextResponse.json({ error: 'body is required.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, b.organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canManageDocumentTemplate({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage document templates for this organization.' }, { status: 403 });
  }

  try {
    const template = await createVersion(
      { organizationId: authz.context.organizationId, templateId, body: b.body, idFactory: () => crypto.randomUUID() },
      { organizationId: authz.context.organizationId, actorIdentityId: identity.id, actorMembershipId: null, actorRoleKey: authz.context.role, correlationId: crypto.randomUUID() },
      dataAdapterMode,
    );
    return NextResponse.json({ template });
  } catch (error) {
    if (error instanceof DocumentTemplateServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.message.includes('not found') ? 404 : 400 });
    }
    throw error;
  }
}
