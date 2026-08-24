import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadAccountsPayable } from '@/services/authorizationPolicyService';
import { listLineItemsForPurchaseOrder, getPurchaseOrderById } from '@/services/purchaseOrderService';
import { listBillableReceiptsForPurchaseOrder } from '@/services/accountsPayableService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 36. Three-way-match view for a PO — each authoritative receipt with
 * its received / already-billed / still-billable quantity and receipt cost.
 * The data a vendor bill is built against (ap.read). Partial states are
 * returned per-receipt, never collapsed to a matched/unmatched boolean.
 */
export async function GET(request: Request, { params }: { params: Promise<{ purchaseOrderId: string }> }) {
  const { purchaseOrderId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canReadAccountsPayable({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view accounts payable.' }, { status: 403 });
  }
  const po = await getPurchaseOrderById(organizationId, purchaseOrderId, dataAdapterMode);
  if (!po) return NextResponse.json({ error: 'Purchase order not found.' }, { status: 404 });
  const lines = await listLineItemsForPurchaseOrder(organizationId, purchaseOrderId, dataAdapterMode);
  const receipts = await listBillableReceiptsForPurchaseOrder(organizationId, lines.map((l) => l.id), dataAdapterMode);
  return NextResponse.json({ purchaseOrderId, lineItems: lines, billableReceipts: receipts });
}
