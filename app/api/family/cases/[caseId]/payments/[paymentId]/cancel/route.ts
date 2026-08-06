import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireFamilyAccess } from '@/lib/auth/requireFamilyAccess';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { getPaymentRecordById, updatePaymentRecord } from '@/services/paymentsService';
import { buildPortalPaymentView } from '@/domain/portal/portalPaymentView';

/**
 * Phase 29 (Family Portal & External Collaboration). The family-side
 * equivalent of the staff `.../payments/[paymentId]/cancel` route — marks
 * a still-pending payment attempt cancelled when the family member lands
 * back on the return page via the checkout provider's own cancel
 * redirect. Same "safe to apply directly, no webhook confirmation
 * needed" reasoning: cancelled carries no claim that money changed
 * hands. A no-op if the payment already reached a terminal state some
 * other way (e.g. the webhook beat the cancel redirect here).
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string; paymentId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { caseId, paymentId } = await params;
  const accessResult = await requireFamilyAccess(caseId, 'payment.pay');
  if (!accessResult.authorized) return accessResult.response;

  const dataAdapterMode = getDataAdapterMode();
  const record = await getPaymentRecordById(accessResult.organizationId, paymentId, dataAdapterMode);
  if (!record || record.caseId !== accessResult.caseId) {
    return NextResponse.json({ payment: null }, { status: 404 });
  }

  if (record.status !== 'pending') {
    return NextResponse.json({ payment: buildPortalPaymentView(record) });
  }

  const updated = await updatePaymentRecord(accessResult.organizationId, paymentId, { status: 'cancelled', updatedAt: new Date().toISOString() }, dataAdapterMode);

  return NextResponse.json({ payment: updated ? buildPortalPaymentView(updated) : null });
}
