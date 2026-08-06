import { NextResponse } from 'next/server';
import { requireFamilyAccess } from '@/lib/auth/requireFamilyAccess';
import { getFamilyPaymentStatus } from '@/services/portal/portalPaymentService';

/**
 * Phase 29 (Family Portal & External Collaboration). Requires
 * `payment.read`. The family return page polls this — never trusting the
 * browser's own redirect outcome, matching the staff-side return route's
 * "the webhook is the only authoritative source of truth" discipline.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const accessResult = await requireFamilyAccess(caseId, 'payment.read');
  if (!accessResult.authorized) return accessResult.response;

  const paymentId = new URL(request.url).searchParams.get('paymentId');
  if (!paymentId) {
    return NextResponse.json({ error: 'paymentId is required.' }, { status: 400 });
  }

  const payment = await getFamilyPaymentStatus(accessResult.organizationId, accessResult.caseId, paymentId, accessResult.dataAdapterMode);
  if (!payment) {
    return NextResponse.json({ payment: null }, { status: 404 });
  }
  return NextResponse.json({ payment });
}
