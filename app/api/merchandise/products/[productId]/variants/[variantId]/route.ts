import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageMerchandise } from '@/services/authorizationPolicyService';
import { updateVariant, archiveVariant, MerchandiseVariantServiceError } from '@/services/merchandiseVariantService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 37 (ADR-041). A single variant. PATCH (merchandise.manage) updates
 * overrides; DELETE archives (fail-closed if it still holds stock, reservations,
 * or open PO lines). Never hard-deletes.
 */
function errorStatus(code: MerchandiseVariantServiceError['code']): number {
  if (code === 'not_found') return 404;
  if (code === 'duplicate_sku') return 409;
  if (code === 'archive_blocked' || code === 'conversion_blocked') return 409;
  return 400;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ productId: string; variantId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { variantId } = await params;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  if (typeof body.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(body.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canManageMerchandise({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage merchandise.' }, { status: 403 });
  }
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  const patch: Record<string, unknown> = {};
  for (const f of ['name', 'optionValues', 'retailPriceOverride', 'costOverride', 'taxableOverride', 'supplierIdOverride'] as const) {
    if (body[f] !== undefined) patch[f] = body[f];
  }
  try {
    const variant = await updateVariant(organizationId, variantId, patch, ctx, dataAdapterMode);
    return NextResponse.json({ variant });
  } catch (error) {
    if (error instanceof MerchandiseVariantServiceError) return NextResponse.json({ error: error.message, code: error.code }, { status: errorStatus(error.code) });
    throw error;
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ productId: string; variantId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { variantId } = await params;
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canManageMerchandise({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage merchandise.' }, { status: 403 });
  }
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const variant = await archiveVariant(organizationId, variantId, ctx, dataAdapterMode);
    return NextResponse.json({ variant });
  } catch (error) {
    if (error instanceof MerchandiseVariantServiceError) return NextResponse.json({ error: error.message, code: error.code }, { status: errorStatus(error.code) });
    throw error;
  }
}
