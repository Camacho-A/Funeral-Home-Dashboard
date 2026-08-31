import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadMerchandise, canManageMerchandise } from '@/services/authorizationPolicyService';
import { listVariantsForProduct } from '@/services/merchandiseService';
import { createVariant, MerchandiseVariantServiceError } from '@/services/merchandiseVariantService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 37 (ADR-041). Variants of one merchandise product. GET
 * (merchandise.read) lists; POST (merchandise.manage) creates. All business
 * logic — SKU uniqueness, bifurcation/transition guards, hasVariants
 * maintenance — lives in merchandiseVariantService; this route only
 * authenticates, authorizes, and delegates.
 */
export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canReadMerchandise({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view merchandise.' }, { status: 403 });
  }
  const includeInactive = url.searchParams.get('includeInactive') === 'true';
  const variants = await listVariantsForProduct(organizationId, productId, dataAdapterMode, { includeInactive });
  return NextResponse.json({ variants });
}

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { productId } = await params;
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
  try {
    const variant = await createVariant({
      organizationId,
      productId,
      sku: String(body.sku ?? ''),
      name: String(body.name ?? ''),
      optionValues: (body.optionValues as Record<string, string> | null | undefined) ?? null,
      retailPriceOverride: body.retailPriceOverride === undefined ? null : (body.retailPriceOverride as number | null),
      costOverride: body.costOverride === undefined ? null : (body.costOverride as number | null),
      taxableOverride: body.taxableOverride === undefined ? null : (body.taxableOverride as boolean | null),
      supplierIdOverride: body.supplierIdOverride === undefined ? null : (body.supplierIdOverride as string | null),
      idFactory: () => crypto.randomUUID(),
    }, ctx, dataAdapterMode);
    return NextResponse.json({ variant }, { status: 201 });
  } catch (error) {
    if (error instanceof MerchandiseVariantServiceError) {
      const status = error.code === 'duplicate_sku' ? 409 : error.code === 'conversion_blocked' ? 409 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    throw error;
  }
}
