import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageInventory } from '@/services/authorizationPolicyService';
import { returnFulfilled, InventoryServiceError } from '@/services/inventoryService';
import { listMerchandiseSelectionsForCase, recalculateOrder } from '@/services/pricingService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 35. Return a fulfilled merchandise item for one (product, location).
 * The inventory side (restock movement + COGS reversal, or a non-restock
 * damage movement) runs through inventoryService; the revenue side is the
 * ordinary order recalculation with that merchandise line removed (posting
 * the negative revenue delta). inventory.manage.
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
  try {
    const balance = await returnFulfilled({ organizationId, caseId, productId: body.productId, locationId: body.locationId, restock, actorStaffProfileId: staffProfile?.id ?? null, idFactory }, ctx, dataAdapterMode);
    // Remove the returned product from the order's merchandise → negative revenue delta.
    const current = await listMerchandiseSelectionsForCase(organizationId, caseId, dataAdapterMode);
    const remaining = current.filter((s) => !(s.productId === body.productId && s.locationId === body.locationId));
    const result = await recalculateOrder({ organizationId, caseId, selections: { merchandise: remaining }, performedBy: userId, idFactory, now: new Date().toISOString() }, dataAdapterMode);
    return NextResponse.json({ balance, order: result?.order ?? null });
  } catch (error) {
    if (error instanceof InventoryServiceError) return NextResponse.json({ error: error.message }, { status: error.code === 'not_found' ? 404 : 400 });
    throw error;
  }
}
