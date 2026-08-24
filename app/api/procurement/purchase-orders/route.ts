import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadProcurement, canManageProcurement } from '@/services/authorizationPolicyService';
import { listPurchaseOrdersForOrganization, createPurchaseOrder, PurchaseOrderServiceError } from '@/services/purchaseOrderService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';
import type { PurchaseOrderStatus } from '@/types/purchaseOrder';

/**
 * Phase 36. Purchase orders. GET (procurement.read) lists; POST
 * (procurement.manage) creates a draft. A PO is a commitment — creating one
 * posts NO journal entry. Delegates entirely to purchaseOrderService.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canReadProcurement({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view purchase orders.' }, { status: 403 });
  }
  const status = (url.searchParams.get('status') as PurchaseOrderStatus | null) ?? undefined;
  const purchaseOrders = await listPurchaseOrdersForOrganization(organizationId, dataAdapterMode, status ? { status } : {});
  return NextResponse.json({ purchaseOrders });
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (typeof body.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (!Array.isArray(body.lines) || body.lines.length === 0) return NextResponse.json({ error: 'At least one line is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(body.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canManageProcurement({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage purchase orders.' }, { status: 403 });
  }
  const staffProfile = await resolveStaffProfileForCaller({ userId, organizationId, role }, dataAdapterMode);
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const result = await createPurchaseOrder(
      {
        organizationId,
        supplierId: String(body.supplierId ?? ''),
        locationId: String(body.locationId ?? ''),
        orderDate: String(body.orderDate ?? new Date().toISOString()),
        expectedDate: (body.expectedDate as string | null) ?? null,
        notes: (body.notes as string | null) ?? null,
        lines: (body.lines as Array<Record<string, unknown>>).map((l) => ({ productId: String(l.productId ?? ''), quantityOrdered: Number(l.quantityOrdered), unitCostCents: Number(l.unitCostCents) })),
        createdByStaffProfileId: staffProfile?.id ?? null,
        idFactory: () => crypto.randomUUID(),
      },
      ctx,
      dataAdapterMode,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof PurchaseOrderServiceError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
