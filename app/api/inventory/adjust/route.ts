import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canAdjustInventory } from '@/services/authorizationPolicyService';
import { adjustStock, InventoryServiceError } from '@/services/inventoryService';
import { getProductById } from '@/services/merchandiseService';
import { notifyInventoryLowStock } from '@/services/inventoryNotifications';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';

const VALID_TYPES = ['adjustment', 'damage', 'shrinkage', 'correction'];

/** Phase 35. Audited inventory adjustment (damage/shrinkage/write-off/
    correction). inventory.adjust — the higher-privilege gate. Reason required. */
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
  if (typeof body.productId !== 'string' || typeof body.locationId !== 'string') return NextResponse.json({ error: 'productId and locationId are required.' }, { status: 400 });
  if (typeof body.movementType !== 'string' || !VALID_TYPES.includes(body.movementType)) return NextResponse.json({ error: `movementType must be one of ${VALID_TYPES.join(', ')}.` }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(body.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canAdjustInventory({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to adjust inventory.' }, { status: 403 });
  }

  const staffProfile = await resolveStaffProfileForCaller({ userId, organizationId, role }, dataAdapterMode);
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const result = await adjustStock(
      {
        organizationId,
        productId: body.productId,
        locationId: body.locationId,
        quantityDelta: Number(body.quantityDelta),
        movementType: body.movementType as 'adjustment' | 'damage' | 'shrinkage' | 'correction',
        reason: String(body.reason ?? ''),
        actorStaffProfileId: staffProfile?.id ?? null,
        idFactory: () => crypto.randomUUID(),
      },
      ctx,
      dataAdapterMode,
    );
    if (result.lowStockCrossed) {
      const product = await getProductById(organizationId, body.productId, dataAdapterMode);
      if (product) await notifyInventoryLowStock(ctx, product.id, product.name, dataAdapterMode);
    }
    return NextResponse.json({ balance: result.balance }, { status: 201 });
  } catch (error) {
    if (error instanceof InventoryServiceError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
