import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadMerchandise, canManageMerchandise } from '@/services/authorizationPolicyService';
import { getProductById, updateProduct, setProductArchived, MerchandiseServiceError } from '@/services/merchandiseService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 35. One product — GET (merchandise.read), PATCH/DELETE-archive
    (merchandise.manage). */
export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canReadMerchandise({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }
  const product = await getProductById(organizationId, productId, dataAdapterMode);
  if (!product) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  return NextResponse.json({ product });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { productId } = await params;
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
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  const patch: Record<string, unknown> = {};
  for (const field of ['name', 'description', 'category', 'cost', 'retailPrice', 'taxable', 'trackInventory', 'reorderPoint', 'defaultLocationId', 'familyVisible', 'supplierName']) {
    if (body[field] !== undefined) patch[field] = body[field];
  }
  try {
    const product = await updateProduct(organizationId, productId, patch, ctx, dataAdapterMode);
    return NextResponse.json({ product });
  } catch (error) {
    if (error instanceof MerchandiseServiceError) return NextResponse.json({ error: error.message }, { status: error.code === 'not_found' ? 404 : 400 });
    throw error;
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { productId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canManageMerchandise({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const product = await setProductArchived(organizationId, productId, true, ctx, dataAdapterMode);
    return NextResponse.json({ product });
  } catch (error) {
    if (error instanceof MerchandiseServiceError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
