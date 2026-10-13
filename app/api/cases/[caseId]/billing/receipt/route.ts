import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canGenerateDocument } from '@/services/authorizationPolicyService';
import { generateReceiptOfPayment, BillingDocumentServiceError } from '@/services/billingDocumentService';
import { getDataAdapterMode } from '@/lib/env';

export const maxDuration = 60;

/**
 * Receipt of Payment (2026-10) — generates the family-facing receipt and
 * files it in the case's Documents, through the same document pipeline
 * and the same `document.generate` permission as every other generated
 * document.
 *
 * Separate from the Statement of Funeral Goods and Services route beside
 * it: that statement is a legally mandated FTC disclosure, this is a
 * receipt, and generating one must never replace the other.
 *
 * Read-only against the accounting ledger — it reads the active order and
 * the recorded payments and posts nothing.
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
  const b = body as { organizationId?: unknown; existingDocumentId?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (b.existingDocumentId !== undefined && typeof b.existingDocumentId !== 'string') {
    return NextResponse.json({ error: 'existingDocumentId must be a string if provided.' }, { status: 400 });
  }

  const auth = await requireAuthorizedOrganization(b.organizationId);
  if (!auth.authorized) return auth.response;
  const { organizationId, userId, role } = auth.context;
  const mode = getDataAdapterMode();

  if (!(await canGenerateDocument({ identityId: userId, organizationId, roleKey: role }, mode))) {
    return NextResponse.json({ error: 'Not authorized to generate documents for this case.' }, { status: 403 });
  }

  try {
    const { document, model } = await generateReceiptOfPayment(
      {
        caseId,
        existingDocumentId: typeof b.existingDocumentId === 'string' ? b.existingDocumentId : undefined,
        idFactory: () => crypto.randomUUID(),
      },
      {
        organizationId,
        actorIdentityId: userId,
        actorMembershipId: null,
        actorRoleKey: role,
        correlationId: crypto.randomUUID(),
      },
      mode,
    );
    return NextResponse.json({ document, missingFields: model.missingFields }, { status: 201 });
  } catch (error) {
    if (error instanceof BillingDocumentServiceError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
