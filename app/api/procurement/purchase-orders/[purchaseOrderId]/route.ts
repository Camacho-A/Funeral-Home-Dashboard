import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadProcurement } from '@/services/authorizationPolicyService';
import { getPurchaseOrderById, listLineItemsForPurchaseOrder } from '@/services/purchaseOrderService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 36. One purchase order with its line items (procurement.read). */
export async function GET(request: Request, { params }: { params: Promise<{ purchaseOrderId: string }> }) {
  const { purchaseOrderId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canReadProcurement({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }
  const purchaseOrder = await getPurchaseOrderById(organizationId, purchaseOrderId, dataAdapterMode);
  if (!purchaseOrder) return NextResponse.json({ error: 'Purchase order not found.' }, { status: 404 });
  const lineItems = await listLineItemsForPurchaseOrder(organizationId, purchaseOrderId, dataAdapterMode);
  return NextResponse.json({ purchaseOrder, lineItems });
}
