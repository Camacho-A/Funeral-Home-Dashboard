import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canReadAccountsPayable, canPayAccountsPayable } from '@/services/authorizationPolicyService';
import { listPaymentsForBill, recordBillPayment, AccountsPayableServiceError } from '@/services/accountsPayableService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';
import type { BillPaymentMethod } from '@/types/billPayment';

/**
 * Phase 36. Vendor payments against a bill. GET (ap.read) lists; POST
 * (ap.pay — SEPARATELY enforceable from ap.manage) records an
 * externally-executed payment. Beacon records the payment and posts Dr 2000
 * AP / Cr Cash through the ledger; it never initiates a bank/ACH/card
 * transfer and never uses the customer-facing PaymentRecord.
 */
export async function GET(request: Request, { params }: { params: Promise<{ billId: string }> }) {
  const { billId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canReadAccountsPayable({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view accounts payable.' }, { status: 403 });
  }
  const payments = await listPaymentsForBill(organizationId, billId, dataAdapterMode);
  return NextResponse.json({ payments });
}

export async function POST(request: Request, { params }: { params: Promise<{ billId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { billId } = await params;
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
  if (!(await canPayAccountsPayable({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to record vendor payments.' }, { status: 403 });
  }
  const staffProfile = await resolveStaffProfileForCaller({ userId, organizationId, role }, dataAdapterMode);
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const result = await recordBillPayment(
      {
        organizationId,
        vendorBillId: billId,
        amountCents: Number(body.amountCents),
        paymentDate: String(body.paymentDate ?? new Date().toISOString()),
        method: (String(body.method ?? 'other') as BillPaymentMethod),
        referenceNumber: (body.referenceNumber as string | null) ?? null,
        cashAccountNumber: String(body.cashAccountNumber ?? ''),
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
      const status = error.code === 'not_found' ? 404 : error.code === 'invalid_state' || error.code === 'over_pay' ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }
}
