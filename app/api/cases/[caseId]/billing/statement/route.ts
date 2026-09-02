import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canGenerateDocument } from '@/services/authorizationPolicyService';
import { generateStatement, BillingDocumentServiceError } from '@/services/billingDocumentService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 39 (Family Billing & FTC Compliance). Generates (or regenerates) the
 * FTC Statement of Funeral Goods and Services Selected for a case, from its
 * authoritative CaseOrder. System-rendered — no template. Reuses
 * `document.generate` (a statement is a case document). Delegates all logic to
 * `billingDocumentService`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;
  const { caseId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; existingDocumentId?: unknown; requiredPurchaseExplanations?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (b.existingDocumentId !== undefined && typeof b.existingDocumentId !== 'string') {
    return NextResponse.json({ error: 'existingDocumentId must be a string if provided.' }, { status: 400 });
  }
  if (b.requiredPurchaseExplanations !== undefined && b.requiredPurchaseExplanations !== null && typeof b.requiredPurchaseExplanations !== 'string') {
    return NextResponse.json({ error: 'requiredPurchaseExplanations must be a string if provided.' }, { status: 400 });
  }

  const auth = await requireAuthorizedOrganization(b.organizationId);
  if (!auth.authorized) return auth.response;
  const { organizationId, userId, role } = auth.context;
  const mode = getDataAdapterMode();

  if (!(await canGenerateDocument({ identityId: userId, organizationId, roleKey: role }, mode))) {
    return NextResponse.json({ error: 'Not authorized to generate documents for this case.' }, { status: 403 });
  }

  try {
    const { document } = await generateStatement(
      {
        caseId,
        existingDocumentId: b.existingDocumentId as string | undefined,
        requiredPurchaseExplanations: (b.requiredPurchaseExplanations as string | null | undefined) ?? null,
        idFactory: () => crypto.randomUUID(),
      },
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      mode,
    );
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    if (error instanceof BillingDocumentServiceError) return NextResponse.json({ error: error.message }, { status: 422 });
    throw error;
  }
}
