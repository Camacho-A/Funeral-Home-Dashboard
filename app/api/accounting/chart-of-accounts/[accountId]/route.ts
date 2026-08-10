import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canManageFinancials } from '@/services/authorizationPolicyService';
import { updateAccount, deactivateAccount, ChartOfAccountsServiceError } from '@/services/chartOfAccountsService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 31. Updates an existing account's name/description/parentAccountId,
    or (when body.deactivate is true) deactivates it — both gated
    `accounting.manage`. `accountNumber`/`accountType` are immutable and
    never accepted here. */
export async function PATCH(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { accountId } = await params;
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId: requestedOrganizationId, name, description, parentAccountId, deactivate } = parsed.body;

  if (typeof requestedOrganizationId !== 'string' || requestedOrganizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canManageFinancials({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage the chart of accounts for this organization.' }, { status: 403 });
  }

  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: accountId };

  try {
    if (deactivate === true) {
      const account = await deactivateAccount(organizationId, accountId, ctx, dataAdapterMode);
      return NextResponse.json({ account });
    }

    const account = await updateAccount(
      organizationId,
      accountId,
      {
        name: typeof name === 'string' ? name : undefined,
        description: typeof description === 'string' ? description : undefined,
        parentAccountId: typeof parentAccountId === 'string' ? parentAccountId : undefined,
      },
      dataAdapterMode,
    );
    return NextResponse.json({ account });
  } catch (error) {
    if (error instanceof ChartOfAccountsServiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
