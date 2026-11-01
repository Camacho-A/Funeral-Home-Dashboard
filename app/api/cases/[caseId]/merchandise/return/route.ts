import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageInventory } from '@/services/authorizationPolicyService';
import { returnFulfilled, InventoryServiceError } from '@/services/inventoryService';
import { getActiveCaseOrder, getCaseOrderState, listMerchandiseSelectionsForCase, recalculateOrder, UnpricedCatalogItemError, CaseOrderConflictError, CaseOrderCommitError, CaseOrderInterruptedError, ORDER_CHANGE_MAX_ATTEMPTS } from '@/services/pricingService';
import { caseOrderOperationErrorResponse } from '@/lib/caseOrderOperationResponses';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 35. Return a fulfilled merchandise item for one (product, location).
 * The inventory side (restock movement + COGS reversal, or a non-restock
 * damage movement) runs through inventoryService; the revenue side is the
 * ordinary order recalculation with that merchandise line removed (posting
 * the negative revenue delta). inventory.manage.
 *
 * Non-destructive order versioning (2026-10): the remaining merchandise is
 * a function of the order as it is NOW, so it is computed from the active
 * version and the recalculation is pinned to that version
 * (`expectedOrderId`). If another edit lands in between, it is recomputed
 * from the new active version — at most ORDER_CHANGE_MAX_ATTEMPTS times,
 * then 409. A stale list can never replace a newer order.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { caseId } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (typeof body.organizationId !== 'string' || typeof body.productId !== 'string' || typeof body.locationId !== 'string') {
    return NextResponse.json({ error: 'organizationId, productId, and locationId are required.' }, { status: 400 });
  }
  const authResult = await requireAuthorizedOrganization(body.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canManageInventory({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to process a return.' }, { status: 403 });
  }
  const restock = body.restock !== false;
  const staffProfile = await resolveStaffProfileForCaller({ userId, organizationId, role }, dataAdapterMode);
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  const idFactory = () => crypto.randomUUID();
  // Phase 5A.2: refused before the stock movement when an unfinished order
  // change holds the case's order — never a return recorded against an
  // order that then can't be updated.
  const { interruption } = await getCaseOrderState(organizationId, caseId, dataAdapterMode);
  if (interruption) return caseOrderOperationErrorResponse(new CaseOrderInterruptedError(interruption))!;
  try {
    const balance = await returnFulfilled({ organizationId, caseId, productId: body.productId, locationId: body.locationId, restock, actorStaffProfileId: staffProfile?.id ?? null, idFactory }, ctx, dataAdapterMode);
    // Remove the returned product from the order's merchandise → negative revenue delta.
    for (let attempt = 0; attempt < ORDER_CHANGE_MAX_ATTEMPTS; attempt++) {
      const active = await getActiveCaseOrder(organizationId, caseId, dataAdapterMode);
      if (!active) return NextResponse.json({ balance, order: null });
      const current = await listMerchandiseSelectionsForCase(organizationId, caseId, dataAdapterMode);
      const remaining = current.filter((s) => !(s.productId === body.productId && s.locationId === body.locationId));
      try {
        const result = await recalculateOrder(
          { organizationId, caseId, selections: { merchandise: remaining }, performedBy: userId, idFactory, now: new Date().toISOString(), expectedOrderId: active.id },
          dataAdapterMode,
        );
        return NextResponse.json({ balance, order: result?.order ?? null });
      } catch (error) {
        if (error instanceof CaseOrderConflictError) continue;
        throw error;
      }
    }
    return NextResponse.json({ error: "This case's order kept changing while the return was being applied. Reload the case and try again.", reason: 'order_conflict' }, { status: 409 });
  } catch (error) {
    if (error instanceof CaseOrderCommitError) {
      return NextResponse.json({ error: error.message, ...(error.conflict ? { reason: 'order_conflict' } : {}), needsRepair: !error.compensated }, { status: error.conflict ? 409 : 503 });
    }
    if (error instanceof InventoryServiceError) return NextResponse.json({ error: error.message }, { status: error.code === 'not_found' ? 404 : 400 });
    // 2026-10: see app/api/cases/[caseId]/merchandise/route.ts.
    if (error instanceof UnpricedCatalogItemError) return NextResponse.json({ error: error.message }, { status: 422 });
    const operationResponse = caseOrderOperationErrorResponse(error);
    if (operationResponse) return operationResponse;
    throw error;
  }
}
