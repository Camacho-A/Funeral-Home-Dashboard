import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canManageFinancials } from '@/services/authorizationPolicyService';
import { deactivateBankAccount, BankingServiceError } from '@/services/bankingService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 31. Deactivates a bank account — the only lifecycle transition
    (never hard-deleted). Gated `accounting.manage`. */
export async function PATCH(request: Request, { params }: { params: Promise<{ bankAccountId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { bankAccountId } = await params;
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId: requestedOrganizationId, deactivate } = parsed.body;

  if (typeof requestedOrganizationId !== 'string' || requestedOrganizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (deactivate !== true) {
    return NextResponse.json({ error: 'Only deactivation is supported by this endpoint.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canManageFinancials({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage bank accounts for this organization.' }, { status: 403 });
  }

  try {
    const account = await deactivateBankAccount(organizationId, bankAccountId, dataAdapterMode);
    return NextResponse.json({ account });
  } catch (error) {
    if (error instanceof BankingServiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
