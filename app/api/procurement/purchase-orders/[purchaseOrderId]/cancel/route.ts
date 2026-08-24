import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageProcurement } from '@/services/authorizationPolicyService';
import { cancelPurchaseOrder, PurchaseOrderServiceError } from '@/services/purchaseOrderService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 36. Cancel a draft/submitted PO with no receipts (procurement.manage). */
export async function POST(request: Request, { params }: { params: Promise<{ purchaseOrderId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { purchaseOrderId } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (typeof body.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(body.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canManageProcurement({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage purchase orders.' }, { status: 403 });
  }
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const purchaseOrder = await cancelPurchaseOrder(organizationId, purchaseOrderId, ctx, dataAdapterMode);
    return NextResponse.json({ purchaseOrder });
  } catch (error) {
    if (error instanceof PurchaseOrderServiceError) return NextResponse.json({ error: error.message }, { status: error.code === 'not_found' ? 404 : error.code === 'invalid_state' ? 409 : 400 });
    throw error;
  }
}
