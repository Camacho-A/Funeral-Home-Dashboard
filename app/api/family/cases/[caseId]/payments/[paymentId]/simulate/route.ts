import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireFamilyAccess } from '@/lib/auth/requireFamilyAccess';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { getPaymentRecordById, updatePaymentRecord } from '@/services/paymentsService';
import { markCasePaidIfVerified } from '@/services/paymentWorkflow';
import { buildPortalPaymentView } from '@/domain/portal/portalPaymentView';

/**
 * Phase 29 (Family Portal & External Collaboration). Mock-mode only — the
 * family-side equivalent of the staff `.../payments/[paymentId]/simulate`
 * route, for the identical reason: there is no real Clover in mock mode
 * to send a webhook, so the family return page calls this to simulate a
 * successful outcome locally ("the webhook arrived and confirmed the
 * payment"). Returns 400 outside mock mode — a real integration's outcome
 * must never be decided by a client-callable endpoint, only by a verified
 * webhook.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string; paymentId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const dataAdapterMode = getDataAdapterMode();
  if (dataAdapterMode !== 'mock') {
    return NextResponse.json({ error: 'Simulated outcomes are only available in mock mode.' }, { status: 400 });
  }

  const { caseId, paymentId } = await params;
  const accessResult = await requireFamilyAccess(caseId, 'payment.pay');
  if (!accessResult.authorized) return accessResult.response;

  const record = await getPaymentRecordById(accessResult.organizationId, paymentId, dataAdapterMode);
  if (!record || record.caseId !== accessResult.caseId) {
    return NextResponse.json({ payment: null }, { status: 404 });
  }
  if (record.status !== 'pending') {
    return NextResponse.json({ payment: buildPortalPaymentView(record) });
  }

  const nowIso = new Date().toISOString();
  const updated = await updatePaymentRecord(
    accessResult.organizationId,
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
    await markCasePaidIfVerified(accessResult.organizationId, accessResult.caseId, dataAdapterMode);
  }

  return NextResponse.json({ payment: updated ? buildPortalPaymentView(updated) : null });
}
