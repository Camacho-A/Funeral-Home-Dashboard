import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadMerchandise, canManageMerchandise } from '@/services/authorizationPolicyService';
import { listProductsForOrganization, createProduct, MerchandiseServiceError } from '@/services/merchandiseService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). The product catalog.
 * GET (merchandise.read) lists; POST (merchandise.manage) creates. Delegates
 * entirely to merchandiseService — no business logic here.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canReadMerchandise({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view merchandise for this organization.' }, { status: 403 });
  }

  const includeInactive = url.searchParams.get('includeInactive') === 'true';
  const products = await listProductsForOrganization(organizationId, dataAdapterMode, { includeInactive });
  return NextResponse.json({ products });
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

  const authResult = await requireAuthorizedOrganization(body.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canManageMerchandise({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage merchandise for this organization.' }, { status: 403 });
  }

  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const product = await createProduct(
      {
        organizationId,
        sku: String(body.sku ?? ''),
        name: String(body.name ?? ''),
        description: body.description === undefined ? null : (body.description as string | null),
        category: String(body.category ?? ''),
        cost: Number(body.cost),
        retailPrice: Number(body.retailPrice),
        taxable: body.taxable === true,
        trackInventory: body.trackInventory !== false,
        reorderPoint: body.reorderPoint == null ? null : Number(body.reorderPoint),
        defaultLocationId: (body.defaultLocationId as string | null) ?? null,
        familyVisible: body.familyVisible === true,
        supplierName: (body.supplierName as string | null) ?? null,
        idFactory: () => crypto.randomUUID(),
      },
      ctx,
      dataAdapterMode,
    );
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    if (error instanceof MerchandiseServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.code === 'duplicate_sku' ? 409 : 400 });
    }
    throw error;
  }
}
