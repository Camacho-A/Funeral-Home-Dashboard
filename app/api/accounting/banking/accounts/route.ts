import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canReadFinancials, canManageFinancials } from '@/services/authorizationPolicyService';
import { listBankAccounts, createBankAccount, BankingServiceError } from '@/services/bankingService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 31 (Financial Management & General Ledger). `GET` lists bank
    accounts (gated `accounting.view`); `POST` creates one, linked to an
    existing asset-type ledger account (gated `accounting.manage`). */
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

  const accounts = await listBankAccounts(organizationId, dataAdapterMode);
  return NextResponse.json({ accounts });
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId: requestedOrganizationId, name, ledgerAccountId, accountNumberLast4, bankName } = parsed.body;

  if (typeof requestedOrganizationId !== 'string' || requestedOrganizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  }
  if (typeof ledgerAccountId !== 'string' || ledgerAccountId.trim().length === 0) {
    return NextResponse.json({ error: 'ledgerAccountId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canManageFinancials({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage bank accounts for this organization.' }, { status: 403 });
  }

  try {
    const account = await createBankAccount(
      organizationId,
      {
        name,
        ledgerAccountId,
        accountNumberLast4: typeof accountNumberLast4 === 'string' ? accountNumberLast4 : null,
        bankName: typeof bankName === 'string' ? bankName : null,
        idFactory: () => crypto.randomUUID(),
      },
      dataAdapterMode,
    );
    return NextResponse.json({ account });
  } catch (error) {
    if (error instanceof BankingServiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
