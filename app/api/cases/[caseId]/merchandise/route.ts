import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canEditCaseOrder } from '@/services/authorizationPolicyService';
import { getActiveCaseOrder, recalculateOrder, listMerchandiseSelectionsForCase } from '@/services/pricingService';
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

  const order = await getActiveCaseOrder(organizationId, caseId, dataAdapterMode);
  if (!order) return NextResponse.json({ error: 'This case has no active order; create the order before adding merchandise.' }, { status: 404 });

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
  const result = await recalculateOrder(
    { organizationId, caseId, selections: { merchandise: Array.from(desired.values()) }, performedBy: userId, idFactory, now: new Date().toISOString() },
    dataAdapterMode,
  );
  if (!result) return NextResponse.json({ error: 'This case has no active order.' }, { status: 404 });
  return NextResponse.json({ order: result.order, lineItems: result.lineItems });
}
