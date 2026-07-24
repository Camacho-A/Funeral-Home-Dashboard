import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { listPaymentRecordsForCase } from '@/services/paymentsService';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Lists every payment
 * attempt (pending, succeeded, failed, cancelled) for one case, most
 * recent first — the "payment history" PaymentCard renders. Read-only
 * and org-scoped by the query itself (a caseId belonging to a different
 * organization simply matches zero records under this organizationId, so
 * there is nothing to leak) — see the checkout route for the stricter,
 * explicit ownership check a state-changing request needs instead.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ payments: [], error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const payments = await listPaymentRecordsForCase(organizationId, caseId, getDataAdapterMode());
  return NextResponse.json({ payments });
}
