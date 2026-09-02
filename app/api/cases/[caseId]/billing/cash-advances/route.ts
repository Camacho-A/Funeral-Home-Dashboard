import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canEditCaseOrder } from '@/services/authorizationPolicyService';
import { listCashAdvanceItems, createCashAdvanceItem, CashAdvanceServiceError } from '@/services/cashAdvanceService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 39 (Family Billing & FTC Compliance). Cash advance items for a case —
 * DISPLAY-ONLY FTC data (never GL/AR/PaymentService). Gated by
 * `caseOrder.update` (it affects the family's compliance statement).
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });

  const auth = await requireAuthorizedOrganization(organizationId);
  if (!auth.authorized) return auth.response;
  const mode = getDataAdapterMode();
  if (!(await canEditCaseOrder({ identityId: auth.context.userId, organizationId: auth.context.organizationId, roleKey: auth.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }
  const items = await listCashAdvanceItems(auth.context.organizationId, caseId, mode);
  return NextResponse.json({ items });
}

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
  const b = body as { organizationId?: unknown; description?: unknown; amountCents?: unknown; hasMarkup?: unknown; isEstimated?: unknown };
  if (typeof b.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (typeof b.description !== 'string') return NextResponse.json({ error: 'description is required.' }, { status: 400 });
  if (typeof b.amountCents !== 'number') return NextResponse.json({ error: 'amountCents is required.' }, { status: 400 });

  const auth = await requireAuthorizedOrganization(b.organizationId);
  if (!auth.authorized) return auth.response;
  const mode = getDataAdapterMode();
  if (!(await canEditCaseOrder({ identityId: auth.context.userId, organizationId: auth.context.organizationId, roleKey: auth.context.role }, mode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }
  try {
    const item = await createCashAdvanceItem(
      {
        organizationId: auth.context.organizationId,
        caseId,
        description: b.description,
        amountCents: b.amountCents,
        hasMarkup: b.hasMarkup === true,
        isEstimated: b.isEstimated === true,
        idFactory: () => crypto.randomUUID(),
      },
      mode,
    );
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof CashAdvanceServiceError) return NextResponse.json({ error: error.message }, { status: 422 });
    throw error;
  }
}
