import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canEditCaseOrder } from '@/services/authorizationPolicyService';
import { getCaseOrderState, recalculateOrder, listMerchandiseSelectionsForCase, UnpricedCatalogItemError, CaseOrderConflictError, CaseOrderCommitError, CaseOrderInterruptedError } from '@/services/pricingService';
import { caseOrderOperationErrorResponse } from '@/lib/caseOrderOperationResponses';
import { syncReservation, releaseReservation, listReservationsForCase, InventoryServiceError } from '@/services/inventoryService';
import { getProductById } from '@/services/merchandiseService';
import { getDataAdapterMode } from '@/lib/env';
import type { MerchandiseSelection } from '@/types/caseOrder';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). The one authoritative place a
 * case's merchandise selection is set. Merchandise integrates into the
 * existing CaseOrder (gated by the existing `caseOrder.update`) — never a
 * competing order. A POST replaces the case's full merchandise list:
 * reserves each item (validating availability — an oversell 409s and nothing
 * changes), releases any dropped item, then recalculates the order (which
 * writes a new order version with the merchandise line items and posts the
 * split revenue delta). Reservation and order recalculation are both
 * idempotent, so a partial failure is safely retryable.
 *
 * Non-destructive order versioning (2026-10): a POST must name the order
 * version it was made against (`expectedOrderId`; missing → 428). If the
 * active order is no longer that version, 409 with the current order —
 * checked BEFORE any reservation changes, and again by the order write
 * itself (its compare-and-swap), so a stale list never replaces a newer one.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canEditCaseOrder({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }
  const selections = await listMerchandiseSelectionsForCase(organizationId, caseId, dataAdapterMode);
  const reservations = await listReservationsForCase(organizationId, caseId, dataAdapterMode);
  return NextResponse.json({ merchandise: selections, reservations });
}

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
  if (typeof body.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  if (!Array.isArray(body.items)) return NextResponse.json({ error: 'items must be an array of { productId, locationId, quantity }.' }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(body.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canEditCaseOrder({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to update this case order.' }, { status: 403 });
  }

  if (body.expectedOrderId === undefined || body.expectedOrderId === null) {
    return NextResponse.json({ error: 'expectedOrderId is required: the id of the case order version being edited.', reason: 'order_version_required' }, { status: 428 });
  }
  if (typeof body.expectedOrderId !== 'string' || body.expectedOrderId.trim() === '') {
    return NextResponse.json({ error: 'expectedOrderId must be a case order id.' }, { status: 400 });
  }
  const expectedOrderId = body.expectedOrderId;

  // Phase 5A.2: checked BEFORE any reservation is touched — an unfinished
  // order change holds the case's order (409, nothing written).
  const { active: order, interruption } = await getCaseOrderState(organizationId, caseId, dataAdapterMode);
  if (interruption) return caseOrderOperationErrorResponse(new CaseOrderInterruptedError(interruption))!;
  if (!order) return NextResponse.json({ error: 'This case has no active order; create the order before adding merchandise.' }, { status: 404 });
  if (order.id !== expectedOrderId) {
    const conflict = new CaseOrderConflictError(order);
    return NextResponse.json({ error: conflict.message, reason: 'order_conflict', order }, { status: 409 });
  }

  // Normalize + aggregate the desired list.
  const desired = new Map<string, MerchandiseSelection>();
  for (const raw of body.items as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.productId !== 'string' || typeof r.locationId !== 'string') continue;
    const qty = Math.trunc(Number(r.quantity));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    desired.set(`${r.productId}::${r.locationId}`, { productId: r.productId, locationId: r.locationId, quantity: qty });
  }

  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  const idFactory = () => crypto.randomUUID();

  try {
    // Reserve each desired item (validates availability for tracked products).
    for (const sel of desired.values()) {
      const product = await getProductById(organizationId, sel.productId, dataAdapterMode);
      if (!product || !product.isActive) return NextResponse.json({ error: `Product ${sel.productId} is not available.` }, { status: 400 });
      if (product.trackInventory) {
        await syncReservation({ organizationId, caseId, caseOrderId: order.id, productId: sel.productId, locationId: sel.locationId, quantity: sel.quantity, idFactory }, ctx, dataAdapterMode);
      }
    }
    // Release any previously-active reservation not in the desired list.
    const priorReservations = await listReservationsForCase(organizationId, caseId, dataAdapterMode);
    for (const res of priorReservations) {
      if (res.status !== 'active') continue;
      if (!desired.has(`${res.productId}::${res.locationId}`)) {
        await releaseReservation(organizationId, caseId, res.productId, res.locationId, ctx, dataAdapterMode);
      }
    }
  } catch (error) {
    if (error instanceof InventoryServiceError) return NextResponse.json({ error: error.message }, { status: error.code === 'insufficient_stock' ? 409 : 400 });
    throw error;
  }

  // Recalculate the order with the full merchandise list — one new version,
  // service lines carried forward, revenue split posted.
  let result: Awaited<ReturnType<typeof recalculateOrder>>;
  try {
    result = await recalculateOrder(
      { organizationId, caseId, selections: { merchandise: Array.from(desired.values()) }, performedBy: userId, idFactory, now: new Date().toISOString(), expectedOrderId },
      dataAdapterMode,
    );
  } catch (error) {
    if (error instanceof CaseOrderConflictError) return NextResponse.json({ error: error.message, reason: 'order_conflict', order: error.current }, { status: 409 });
    if (error instanceof CaseOrderCommitError) {
      return NextResponse.json({ error: error.message, ...(error.conflict ? { reason: 'order_conflict' } : {}), needsRepair: !error.compensated }, { status: error.conflict ? 409 : 503 });
    }
    // 2026-10: a carried-forward service whose price has since been cleared
    // (Settings › Price Catalog) — the order can't be re-saved until
    // it's priced again. Never persisted at an invented amount.
    if (error instanceof UnpricedCatalogItemError) return NextResponse.json({ error: error.message }, { status: 422 });
    const operationResponse = caseOrderOperationErrorResponse(error);
    if (operationResponse) return operationResponse;
    throw error;
  }
  if (!result) return NextResponse.json({ error: 'This case has no active order.' }, { status: 404 });
  return NextResponse.json({ order: result.order, lineItems: result.lineItems });
}
