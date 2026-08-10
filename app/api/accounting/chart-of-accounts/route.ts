import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canReadFinancials, canManageFinancials } from '@/services/authorizationPolicyService';
import { listAccounts, createAccount, ChartOfAccountsServiceError } from '@/services/chartOfAccountsService';
import { getDataAdapterMode } from '@/lib/env';
import type { LedgerAccountType, LedgerAccountNormalBalance } from '@/types/ledgerAccount';

/**
 * Phase 31 (Financial Management & General Ledger). Chart of Accounts —
 * `GET` gated `accounting.view`, `POST` gated `accounting.manage`.
 */
export async function GET(request: Request) {
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReadFinancials({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view financial data for this organization.' }, { status: 403 });
  }

  const accounts = await listAccounts(organizationId, dataAdapterMode);
  return NextResponse.json({ accounts });
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId: requestedOrganizationId, accountNumber, name, accountType, normalBalance, parentAccountId, description } = parsed.body;

  if (typeof requestedOrganizationId !== 'string' || requestedOrganizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof accountNumber !== 'string' || accountNumber.trim().length === 0) {
    return NextResponse.json({ error: 'accountNumber is required.' }, { status: 400 });
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  }
  const validTypes: LedgerAccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
  if (typeof accountType !== 'string' || !validTypes.includes(accountType as LedgerAccountType)) {
    return NextResponse.json({ error: 'accountType must be one of asset/liability/equity/revenue/expense.' }, { status: 400 });
  }
  const validNormalBalances: LedgerAccountNormalBalance[] = ['debit', 'credit'];
  if (typeof normalBalance !== 'string' || !validNormalBalances.includes(normalBalance as LedgerAccountNormalBalance)) {
    return NextResponse.json({ error: 'normalBalance must be "debit" or "credit".' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canManageFinancials({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage the chart of accounts for this organization.' }, { status: 403 });
  }

  try {
    const account = await createAccount(
      organizationId,
      {
        accountNumber,
        name,
        accountType: accountType as LedgerAccountType,
        normalBalance: normalBalance as LedgerAccountNormalBalance,
        parentAccountId: typeof parentAccountId === 'string' ? parentAccountId : null,
        description: typeof description === 'string' ? description : null,
        idFactory: () => crypto.randomUUID(),
      },
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
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
