import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageInventory } from '@/services/authorizationPolicyService';
import { transferStock, InventoryServiceError } from '@/services/inventoryService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 35. Transfer stock between two locations. inventory.manage. */
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
  if (typeof body.productId !== 'string' || typeof body.fromLocationId !== 'string' || typeof body.toLocationId !== 'string') {
    return NextResponse.json({ error: 'productId, fromLocationId, and toLocationId are required.' }, { status: 400 });
  }
  const authResult = await requireAuthorizedOrganization(body.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canManageInventory({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to transfer inventory.' }, { status: 403 });
  }
  const staffProfile = await resolveStaffProfileForCaller({ userId, organizationId, role }, dataAdapterMode);
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const result = await transferStock(
      { organizationId, productId: body.productId, fromLocationId: body.fromLocationId, toLocationId: body.toLocationId, quantity: Number(body.quantity), actorStaffProfileId: staffProfile?.id ?? null, idFactory: () => crypto.randomUUID() },
      ctx,
      dataAdapterMode,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof InventoryServiceError) return NextResponse.json({ error: error.message }, { status: error.code === 'insufficient_stock' ? 409 : 400 });
    throw error;
  }
}
