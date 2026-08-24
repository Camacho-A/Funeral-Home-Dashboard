import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageInventory } from '@/services/authorizationPolicyService';
import { receiveAgainstPurchaseOrder, PurchaseOrderServiceError } from '@/services/purchaseOrderService';
import { InventoryServiceError } from '@/services/inventoryService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 36. Receive goods against a PO. Governed by the EXISTING
 * `inventory.manage` permission — receiving is an inventory operation owned
 * by the Phase 35 subsystem; this route only orchestrates. The actual stock
 * movement + GRNI posting happens inside inventoryService.receiveStock.
 */
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
  if (!Array.isArray(body.receipts) || body.receipts.length === 0) return NextResponse.json({ error: 'At least one receipt line is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(body.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canManageInventory({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to receive inventory.' }, { status: 403 });
  }
  const staffProfile = await resolveStaffProfileForCaller({ userId, organizationId, role }, dataAdapterMode);
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const purchaseOrder = await receiveAgainstPurchaseOrder(
      {
        organizationId,
        purchaseOrderId,
        receiptReference: String(body.receiptReference ?? crypto.randomUUID()),
        receipts: (body.receipts as Array<Record<string, unknown>>).map((r) => ({ purchaseOrderLineItemId: String(r.purchaseOrderLineItemId ?? ''), quantity: Number(r.quantity), unitCostCents: r.unitCostCents == null ? undefined : Number(r.unitCostCents) })),
        actorStaffProfileId: staffProfile?.id ?? null,
        idFactory: () => crypto.randomUUID(),
      },
      ctx,
      dataAdapterMode,
    );
    return NextResponse.json({ purchaseOrder }, { status: 201 });
  } catch (error) {
    if (error instanceof PurchaseOrderServiceError) return NextResponse.json({ error: error.message }, { status: error.code === 'not_found' ? 404 : error.code === 'invalid_state' || error.code === 'over_receipt' ? 409 : 400 });
    if (error instanceof InventoryServiceError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
