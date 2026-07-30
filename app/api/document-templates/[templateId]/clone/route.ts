import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageDocumentTemplate } from '@/services/authorizationPolicyService';
import { cloneTemplate, DocumentTemplateServiceError } from '@/services/documentTemplatesService';

/**
 * Phase 25 (Document Generation & Template Management). "Duplicate
 * Template" — mirrors `POST /api/rbac/roles/[roleId]/clone`'s exact
 * "never mutates the source, produces a new independent id" contract.
 */
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
  const b = body as { organizationId?: unknown; name?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof b.name !== 'string' || !b.name.trim()) {
    return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, b.organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canManageDocumentTemplate({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage document templates for this organization.' }, { status: 403 });
  }

  try {
    const template = await cloneTemplate(
      { organizationId: authz.context.organizationId, sourceTemplateId: templateId, name: b.name, idFactory: () => crypto.randomUUID() },
      { organizationId: authz.context.organizationId, actorIdentityId: identity.id, actorMembershipId: null, actorRoleKey: authz.context.role, correlationId: crypto.randomUUID() },
      dataAdapterMode,
    );
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof DocumentTemplateServiceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
