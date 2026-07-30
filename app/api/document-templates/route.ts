import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadDocumentTemplate, canManageDocumentTemplate } from '@/services/authorizationPolicyService';
import { list, createTemplate, DocumentTemplateServiceError } from '@/services/documentTemplatesService';
import { isValidDocumentTypeKey } from '@/domain/documents/documentTypeRegistry';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 25 (Document Generation & Template Management).
 *
 * GET is dual-mode (`requireAuthorizedOrganization`, matching the
 * case-scoped document routes) rather than identity-only: unlike the
 * Template Library management page (identity-mode-gated, per its own
 * settings-page redirect), this list is also read by the case-scoped
 * Generate/Regenerate Document dialog on the universal Case Detail page,
 * which must work in every auth mode exactly like case-document listing
 * already does.
 *
 * POST (template creation) stays identity-mode only, matching every other
 * `audit.read`/`audit.export`-gated route's exact pattern (Phase 24):
 * `requireIdentitySession` -> `resolveMembershipAuthorizationContext` ->
 * a `canX` permission check — template *management* is only ever reachable
 * from the identity-mode-gated Template Library page, so this has no
 * legacy mock/wix precedent to preserve, same reasoning as `/api/activity`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId: resolvedOrganizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReadDocumentTemplate({ identityId: userId, organizationId: resolvedOrganizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view document templates for this organization.' }, { status: 403 });
  }

  const templates = await list(resolvedOrganizationId, dataAdapterMode);
  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; name?: unknown; documentTypeKey?: unknown; category?: unknown; body?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof b.name !== 'string' || !b.name.trim()) {
    return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  }
  if (typeof b.documentTypeKey !== 'string' || !isValidDocumentTypeKey(b.documentTypeKey)) {
    return NextResponse.json({ error: 'A valid documentTypeKey is required.' }, { status: 400 });
  }
  if (typeof b.category !== 'string') {
    return NextResponse.json({ error: 'category is required.' }, { status: 400 });
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
    const template = await createTemplate(
      {
        organizationId: authz.context.organizationId,
        name: b.name,
        documentTypeKey: b.documentTypeKey,
        category: b.category as never,
        body: b.body,
        idFactory: () => crypto.randomUUID(),
      },
      { organizationId: authz.context.organizationId, actorIdentityId: identity.id, actorMembershipId: null, actorRoleKey: authz.context.role, correlationId: crypto.randomUUID() },
      dataAdapterMode,
    );
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof DocumentTemplateServiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
