import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadAccountsPayable } from '@/services/authorizationPolicyService';
import { getBillById, listLineItemsForBill, listPaymentsForBill } from '@/services/accountsPayableService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 36. One vendor bill with its first-class line items and payments
    (ap.read). */
export async function GET(request: Request, { params }: { params: Promise<{ billId: string }> }) {
  const { billId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canReadAccountsPayable({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view accounts payable.' }, { status: 403 });
  }
  const bill = await getBillById(organizationId, billId, dataAdapterMode);
  if (!bill) return NextResponse.json({ error: 'Bill not found.' }, { status: 404 });
  const [lineItems, payments] = await Promise.all([
    listLineItemsForBill(organizationId, billId, dataAdapterMode),
    listPaymentsForBill(organizationId, billId, dataAdapterMode),
  ]);
  return NextResponse.json({ bill, lineItems, payments });
}
