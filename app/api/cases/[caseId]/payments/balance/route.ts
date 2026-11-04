import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadPayment } from '@/services/authorizationPolicyService';
import { getCaseBalance } from '@/services/caseBalanceService';

/**
 * Case balance and overpayment (2026-11). Read-only: what the family has
 * paid against the case's current order, what is still owed (never
 * negative) and any money received beyond the total, so staff are warned
 * about it (domain/billing/caseBalance.ts). Same `payment.read` gate as
 * the payment history. Organization-scoped by the session; nothing is
 * refunded, credited or changed.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const dataAdapterMode = getDataAdapterMode();
  if (!(await canReadPayment({ identityId: authResult.context.userId, organizationId, roleKey: authResult.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  return NextResponse.json({ balance: await getCaseBalance(organizationId, caseId, dataAdapterMode) });
}
