import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadProcurement, canManageProcurement } from '@/services/authorizationPolicyService';
import { listSuppliersForOrganization, createSupplier, SupplierServiceError } from '@/services/supplierService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 36 (Procurement & Accounts Payable). Supplier directory. GET
 * (procurement.read) lists; POST (procurement.manage) creates. Delegates
 * entirely to supplierService — no business logic here.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canReadProcurement({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view suppliers.' }, { status: 403 });
  }
  const includeInactive = url.searchParams.get('includeInactive') === 'true';
  const suppliers = await listSuppliersForOrganization(organizationId, dataAdapterMode, { includeInactive });
  return NextResponse.json({ suppliers });
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
  if (!(await canManageProcurement({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage suppliers.' }, { status: 403 });
  }
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const supplier = await createSupplier(
      {
        organizationId,
        name: String(body.name ?? ''),
        contactName: (body.contactName as string | null) ?? null,
        email: (body.email as string | null) ?? null,
        phone: (body.phone as string | null) ?? null,
        addressText: (body.addressText as string | null) ?? null,
        paymentTermsDays: body.paymentTermsDays == null ? null : Number(body.paymentTermsDays),
        defaultExpenseAccountNumber: (body.defaultExpenseAccountNumber as string | null) ?? null,
        notes: (body.notes as string | null) ?? null,
        idFactory: () => crypto.randomUUID(),
      },
      ctx,
      dataAdapterMode,
    );
    return NextResponse.json({ supplier }, { status: 201 });
  } catch (error) {
    if (error instanceof SupplierServiceError) return NextResponse.json({ error: error.message }, { status: error.code === 'duplicate_name' ? 409 : 400 });
    throw error;
  }
}
