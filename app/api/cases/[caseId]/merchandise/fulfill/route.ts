import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageInventory } from '@/services/authorizationPolicyService';
import { fulfillReservation, InventoryServiceError } from '@/services/inventoryService';
import { getProductById } from '@/services/merchandiseService';
import { notifyInventoryLowStock } from '@/services/inventoryNotifications';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 35. Fulfill (issue) a case's reserved merchandise for one
    (product, location): sale movement + COGS posting. inventory.manage. */
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
    return NextResponse.json({ error: 'Not authorized to fulfill merchandise.' }, { status: 403 });
  }
  const staffProfile = await resolveStaffProfileForCaller({ userId, organizationId, role }, dataAdapterMode);
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const result = await fulfillReservation({ organizationId, caseId, productId: body.productId, locationId: body.locationId, actorStaffProfileId: staffProfile?.id ?? null, idFactory: () => crypto.randomUUID() }, ctx, dataAdapterMode);
    if (result.lowStockCrossed) {
      const product = await getProductById(organizationId, body.productId, dataAdapterMode);
      if (product) await notifyInventoryLowStock(ctx, product.id, product.name, dataAdapterMode);
    }
    return NextResponse.json({ balance: result.balance });
  } catch (error) {
    if (error instanceof InventoryServiceError) return NextResponse.json({ error: error.message }, { status: error.code === 'not_found' ? 404 : 400 });
    throw error;
  }
}
