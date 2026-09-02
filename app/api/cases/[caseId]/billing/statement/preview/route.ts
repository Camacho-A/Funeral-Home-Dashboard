import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canGenerateDocument } from '@/services/authorizationPolicyService';
import { previewStatementModel, BillingDocumentServiceError } from '@/services/billingDocumentService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 39 (Family Billing & FTC Compliance). Read-only preview of the FTC
 * Statement snapshot model for a case — lets staff review the itemization and
 * the FTC-total / AR-balance figures BEFORE generating the immutable PDF. No
 * document is created. Gated by `document.generate`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });

  const auth = await requireAuthorizedOrganization(organizationId);
  if (!auth.authorized) return auth.response;
  const mode = getDataAdapterMode();
  if (!(await canGenerateDocument({ identityId: auth.context.userId, organizationId: auth.context.organizationId, roleKey: auth.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }
  try {
    const model = await previewStatementModel(
      caseId,
      { organizationId: auth.context.organizationId, actorIdentityId: auth.context.userId, actorMembershipId: null, actorRoleKey: auth.context.role, correlationId: 'preview' },
      mode,
    );
    return NextResponse.json({ model });
  } catch (error) {
    if (error instanceof BillingDocumentServiceError) return NextResponse.json({ error: error.message }, { status: 422 });
    throw error;
  }
}
