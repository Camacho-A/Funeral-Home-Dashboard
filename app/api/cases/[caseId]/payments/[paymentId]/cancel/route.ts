import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { getPaymentRecordById, updatePaymentRecord } from '@/services/paymentsService';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Marks a still-pending
 * payment attempt cancelled — reached when the customer lands back on
 * Beacon via Clover's cancel redirect (see
 * app/(portal)/cases/[caseId]/payments/return/page.tsx). Safe to apply
 * directly from the client's own request, unlike a "succeeded" status:
 * "cancelled" carries no claim that money changed hands, so nothing here
 * needs webhook confirmation — the worst case of a wrong cancel mark is
 * an extra, always-available retry via PaymentCard, never a false
 * "payment collected" state.
 *
 * A no-op (still returns the current record) if the payment has already
 * reached a terminal state some other way (e.g. the webhook beat the
 * cancel redirect to the server) — never overwrites a real outcome.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string; paymentId: string }> }) {
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

  const dataAdapterMode = getDataAdapterMode();
  const record = await getPaymentRecordById(organizationId, paymentId, dataAdapterMode);
  if (!record || record.caseId !== caseId) {
    return NextResponse.json({ payment: null }, { status: 404 });
  }

  if (record.status !== 'pending') {
    return NextResponse.json({ payment: record });
  }

  const updated = await updatePaymentRecord(
    organizationId,
    paymentId,
    { status: 'cancelled', updatedAt: new Date().toISOString() },
    dataAdapterMode,
  );
  return NextResponse.json({ payment: updated });
}
