import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadProcurement, canManageProcurement } from '@/services/authorizationPolicyService';
import { getSupplierById, updateSupplier, setSupplierArchived, SupplierServiceError } from '@/services/supplierService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 36. One supplier — GET (procurement.read), PATCH/DELETE-archive
    (procurement.manage). */
export async function GET(request: Request, { params }: { params: Promise<{ supplierId: string }> }) {
  const { supplierId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canReadProcurement({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }
  const supplier = await getSupplierById(organizationId, supplierId, dataAdapterMode);
  if (!supplier) return NextResponse.json({ error: 'Supplier not found.' }, { status: 404 });
  return NextResponse.json({ supplier });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ supplierId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { supplierId } = await params;
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
  if (!(await canManageProcurement({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage suppliers.' }, { status: 403 });
  }
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  const patch: Record<string, unknown> = { ...body };
  delete patch.organizationId;
  try {
    const supplier = await updateSupplier(organizationId, supplierId, patch, ctx, dataAdapterMode);
    return NextResponse.json({ supplier });
  } catch (error) {
    if (error instanceof SupplierServiceError) return NextResponse.json({ error: error.message }, { status: error.code === 'not_found' ? 404 : error.code === 'duplicate_name' ? 409 : 400 });
    throw error;
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ supplierId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { supplierId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canManageProcurement({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage suppliers.' }, { status: 403 });
  }
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const supplier = await setSupplierArchived(organizationId, supplierId, true, ctx, dataAdapterMode);
    return NextResponse.json({ supplier });
  } catch (error) {
    if (error instanceof SupplierServiceError) return NextResponse.json({ error: error.message }, { status: error.code === 'not_found' ? 404 : 400 });
    throw error;
  }
}
