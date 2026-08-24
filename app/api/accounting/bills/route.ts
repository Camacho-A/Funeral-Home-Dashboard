import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadAccountsPayable, canManageAccountsPayable } from '@/services/authorizationPolicyService';
import { listBillsForOrganization, createVendorBill, AccountsPayableServiceError } from '@/services/accountsPayableService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';
import type { VendorBillStatus } from '@/types/vendorBill';

/**
 * Phase 36. Vendor bills. GET (ap.read) lists; POST (ap.manage) enters a
 * bill. The bill's totals and journal entry are computed SERVER-SIDE by
 * accountsPayableService from the referenced receipts and expense accounts —
 * the route never accepts a client-authoritative total, and never touches
 * inventory or the customer PaymentService.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canReadAccountsPayable({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view accounts payable.' }, { status: 403 });
  }
  const status = (url.searchParams.get('status') as VendorBillStatus | null) ?? undefined;
  const bills = await listBillsForOrganization(organizationId, dataAdapterMode, status ? { status } : {});
  return NextResponse.json({ bills });
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
  if (!(await canManageAccountsPayable({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage vendor bills.' }, { status: 403 });
  }
  const staffProfile = await resolveStaffProfileForCaller({ userId, organizationId, role }, dataAdapterMode);
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const result = await createVendorBill(
      {
        organizationId,
        supplierId: String(body.supplierId ?? ''),
        billNumber: String(body.billNumber ?? ''),
        purchaseOrderId: (body.purchaseOrderId as string | null) ?? null,
        billDate: String(body.billDate ?? new Date().toISOString()),
        dueDate: String(body.dueDate ?? new Date().toISOString()),
        goodsLines: Array.isArray(body.goodsLines) ? (body.goodsLines as Array<Record<string, unknown>>).map((g) => ({ receiptMovementId: String(g.receiptMovementId ?? ''), quantityBilled: Number(g.quantityBilled), billedUnitCostCents: Number(g.billedUnitCostCents) })) : [],
        expenseLines: Array.isArray(body.expenseLines) ? (body.expenseLines as Array<Record<string, unknown>>).map((e) => ({ accountNumber: String(e.accountNumber ?? ''), amountCents: Number(e.amountCents), description: (e.description as string | null) ?? null })) : [],
        notes: (body.notes as string | null) ?? null,
        createdByStaffProfileId: staffProfile?.id ?? null,
        idFactory: () => crypto.randomUUID(),
      },
      ctx,
      dataAdapterMode,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AccountsPayableServiceError) {
      const status = error.code === 'duplicate_bill' ? 409 : error.code === 'over_bill' ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }
}
