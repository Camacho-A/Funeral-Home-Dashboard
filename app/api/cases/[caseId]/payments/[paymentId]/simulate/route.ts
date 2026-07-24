import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { getPaymentRecordById, updatePaymentRecord } from '@/services/paymentsService';
import { markCasePaidIfVerified } from '@/services/paymentWorkflow';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Mock-mode only: since
 * there is no real Clover to send a webhook in mock mode (see
 * services/paymentsService.ts's own comment on why mock-mode checkout
 * creation never calls lib/clover/*), the payments/return page calls this
 * to simulate a successful outcome locally — the mock-mode equivalent of
 * "the webhook arrived and confirmed the payment." Returns 400 in wix
 * mode: a real integration must never have its outcome decided by a
 * client-callable endpoint like this one, only by a verified webhook (see
 * app/api/webhooks/clover/route.ts) or the GET status route's own
 * best-effort Clover reconciliation.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string; paymentId: string }> }) {
  const dataAdapterMode = getDataAdapterMode();
  if (dataAdapterMode !== 'mock') {
    return NextResponse.json({ error: 'Simulated outcomes are only available in mock mode.' }, { status: 400 });
  }

  const { caseId, paymentId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>).organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization((body as Record<string, unknown>).organizationId as string);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const record = await getPaymentRecordById(organizationId, paymentId, dataAdapterMode);
  if (!record || record.caseId !== caseId) {
    return NextResponse.json({ payment: null }, { status: 404 });
  }
  if (record.status !== 'pending') {
    return NextResponse.json({ payment: record });
  }

  const nowIso = new Date().toISOString();
  const updated = await updatePaymentRecord(
    organizationId,
    paymentId,
    {
      status: 'succeeded',
      providerPaymentId: `mock-payment-${paymentId}`,
      cardBrand: 'visa',
      cardLast4: '1111',
      receiptReference: `mock-receipt-${paymentId}`,
      paidAt: nowIso,
      updatedAt: nowIso,
    },
    dataAdapterMode,
  );

  if (updated) {
    await markCasePaidIfVerified(organizationId, caseId, dataAdapterMode);
  }

  return NextResponse.json({ payment: updated });
}
