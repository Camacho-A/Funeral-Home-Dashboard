import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canGenerateDocument } from '@/services/authorizationPolicyService';
import { buildReceiptOfPaymentModel, BillingDocumentServiceError } from '@/services/billingDocumentService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Receipt preview (2026-10). Returns the assembled model WITHOUT producing
 * or storing a document, so staff can see the figures — and anything the
 * case is missing — before anything is filed or sent to a family.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const requested = new URL(request.url).searchParams.get('organizationId');
  if (!requested) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });

  const auth = await requireAuthorizedOrganization(requested);
  if (!auth.authorized) return auth.response;
  const { organizationId, userId, role } = auth.context;
  const mode = getDataAdapterMode();

  if (!(await canGenerateDocument({ identityId: userId, organizationId, roleKey: role }, mode))) {
    return NextResponse.json({ error: 'Not authorized to generate documents for this case.' }, { status: 403 });
  }

  try {
    const model = await buildReceiptOfPaymentModel({ caseId }, organizationId, mode);
    return NextResponse.json({ model });
  } catch (error) {
    if (error instanceof BillingDocumentServiceError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
