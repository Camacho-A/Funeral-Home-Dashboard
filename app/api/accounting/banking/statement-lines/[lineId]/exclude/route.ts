import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canReconcileBank } from '@/services/authorizationPolicyService';
import { excludeStatementLine, BankingServiceError } from '@/services/bankingService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 31. Excludes a bank-only line with no corresponding Beacon
    entry (e.g. a bank fee) from matching — see
    `excludeStatementLine`'s own comment on the disclosed gap this leaves
    (staff must separately post a manual adjustment). Gated
    `accounting.reconcile`. */
export async function POST(request: Request, { params }: { params: Promise<{ lineId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { lineId } = await params;
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId: requestedOrganizationId } = parsed.body;

  if (typeof requestedOrganizationId !== 'string' || requestedOrganizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReconcileBank({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to exclude bank statement lines for this organization.' }, { status: 403 });
  }

  try {
    const line = await excludeStatementLine(organizationId, lineId, dataAdapterMode);
    return NextResponse.json({ line });
  } catch (error) {
    if (error instanceof BankingServiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
