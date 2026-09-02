import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canEditCaseOrder } from '@/services/authorizationPolicyService';
import { updateCashAdvanceItem, archiveCashAdvanceItem, CashAdvanceServiceError } from '@/services/cashAdvanceService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 39. Edit / archive a single cash advance item (display-only FTC data). */
export async function PATCH(request: Request, { params }: { params: Promise<{ caseId: string; itemId: string }> }) {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;
  const { caseId, itemId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; description?: unknown; amountCents?: unknown; hasMarkup?: unknown; isEstimated?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });

  const auth = await requireAuthorizedOrganization(b.organizationId);
  if (!auth.authorized) return auth.response;
  const mode = getDataAdapterMode();
  if (!(await canEditCaseOrder({ identityId: auth.context.userId, organizationId: auth.context.organizationId, roleKey: auth.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }
  try {
    const item = await updateCashAdvanceItem(
      auth.context.organizationId,
      caseId,
      itemId,
      {
        description: typeof b.description === 'string' ? b.description : undefined,
        amountCents: typeof b.amountCents === 'number' ? b.amountCents : undefined,
        hasMarkup: typeof b.hasMarkup === 'boolean' ? b.hasMarkup : undefined,
        isEstimated: typeof b.isEstimated === 'boolean' ? b.isEstimated : undefined,
      },
      mode,
    );
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof CashAdvanceServiceError) return NextResponse.json({ error: error.message }, { status: error.message.includes('not found') ? 404 : 422 });
    throw error;
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ caseId: string; itemId: string }> }) {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;
  const { caseId, itemId } = await params;
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });

  const auth = await requireAuthorizedOrganization(organizationId);
  if (!auth.authorized) return auth.response;
  const mode = getDataAdapterMode();
  if (!(await canEditCaseOrder({ identityId: auth.context.userId, organizationId: auth.context.organizationId, roleKey: auth.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }
  try {
    const item = await archiveCashAdvanceItem(auth.context.organizationId, caseId, itemId, mode);
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof CashAdvanceServiceError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
