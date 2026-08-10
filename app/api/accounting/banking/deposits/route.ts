import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canReadFinancials, canPostJournalEntry } from '@/services/authorizationPolicyService';
import { postDepositTransaction, listBankDepositsForOrganization, FinancialTransactionServiceError } from '@/services/financialTransactionService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 31. `GET` lists bank deposits (gated `accounting.view`); `POST`
    sweeps one or more succeeded payments into a deposit (Dr Cash-Bank /
    Cr Undeposited Funds) — gated `accounting.post`. */
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

  const deposits = await listBankDepositsForOrganization(organizationId, dataAdapterMode);
  return NextResponse.json({ deposits });
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId: requestedOrganizationId, bankAccountLedgerAccountId, paymentIds, depositDate, memo } = parsed.body;

  if (typeof requestedOrganizationId !== 'string' || requestedOrganizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof bankAccountLedgerAccountId !== 'string' || bankAccountLedgerAccountId.trim().length === 0) {
    return NextResponse.json({ error: 'bankAccountLedgerAccountId is required.' }, { status: 400 });
  }
  if (!Array.isArray(paymentIds) || paymentIds.length === 0 || !paymentIds.every((id) => typeof id === 'string')) {
    return NextResponse.json({ error: 'paymentIds must be a non-empty array of strings.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canPostJournalEntry({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to post deposits for this organization.' }, { status: 403 });
  }

  try {
    const staffProfile = await resolveStaffProfileForCaller(authResult.context, dataAdapterMode);
    const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
    const result = await postDepositTransaction(
      organizationId,
      {
        bankAccountLedgerAccountId,
        paymentIds,
        depositDate: typeof depositDate === 'string' ? depositDate : undefined,
        memo: typeof memo === 'string' ? memo : null,
        createdByStaffProfileId: staffProfile?.id ?? null,
        idFactory: () => crypto.randomUUID(),
      },
      ctx,
      dataAdapterMode,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof FinancialTransactionServiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
