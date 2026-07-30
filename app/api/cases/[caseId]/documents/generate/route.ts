import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canGenerateDocument } from '@/services/authorizationPolicyService';
import { generate, DocumentServiceError } from '@/services/documentService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 25 (Document Generation & Template Management). Generates a new
 * document (or, when `existingDocumentId` is provided, a regeneration —
 * see this phase's Invariants: the row it names is superseded, never
 * edited). `templateVersion` is the explicit-choice override; omitted,
 * `DocumentService.generate` resolves the template's current latest
 * version.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { caseId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; templateId?: unknown; templateVersion?: unknown; existingDocumentId?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof b.templateId !== 'string') {
    return NextResponse.json({ error: 'templateId is required.' }, { status: 400 });
  }
  if (b.templateVersion !== undefined && typeof b.templateVersion !== 'number') {
    return NextResponse.json({ error: 'templateVersion must be a number if provided.' }, { status: 400 });
  }
  if (b.existingDocumentId !== undefined && typeof b.existingDocumentId !== 'string') {
    return NextResponse.json({ error: 'existingDocumentId must be a string if provided.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canGenerateDocument({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to generate documents for this case.' }, { status: 403 });
  }

  const correlationId = crypto.randomUUID();
  try {
    const document = await generate(
      {
        caseId,
        templateId: b.templateId,
        templateVersion: b.templateVersion as number | undefined,
        existingDocumentId: b.existingDocumentId as string | undefined,
        idFactory: () => crypto.randomUUID(),
      },
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId },
      dataAdapterMode,
    );
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    if (error instanceof DocumentServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.message.includes('not found') ? 404 : 422 });
    }
    throw error;
  }
}
