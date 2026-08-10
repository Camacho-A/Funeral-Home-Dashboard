import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canReadFinancials, canReconcileBank } from '@/services/authorizationPolicyService';
import { listReconciliationHistory, startReconciliation, BankingServiceError } from '@/services/bankingService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 31. `GET` lists a bank account's reconciliation history (gated
    `accounting.view`); `POST` starts a new one (gated
    `accounting.reconcile`). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  const bankAccountId = url.searchParams.get('bankAccountId');
  if (!requestedOrganizationId || !bankAccountId) {
    return NextResponse.json({ error: 'organizationId and bankAccountId are required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReadFinancials({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view financial data for this organization.' }, { status: 403 });
  }

  const reconciliations = await listReconciliationHistory(organizationId, bankAccountId, dataAdapterMode);
  return NextResponse.json({ reconciliations });
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId: requestedOrganizationId, bankAccountId, statementEndingDate, statementEndingBalance, bankStatementImportId } = parsed.body;

  if (typeof requestedOrganizationId !== 'string' || requestedOrganizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof bankAccountId !== 'string' || bankAccountId.trim().length === 0) {
    return NextResponse.json({ error: 'bankAccountId is required.' }, { status: 400 });
  }
  if (typeof statementEndingDate !== 'string' || statementEndingDate.trim().length === 0) {
    return NextResponse.json({ error: 'statementEndingDate is required.' }, { status: 400 });
  }
  if (typeof statementEndingBalance !== 'number') {
    return NextResponse.json({ error: 'statementEndingBalance is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReconcileBank({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to reconcile bank accounts for this organization.' }, { status: 403 });
  }

  try {
    const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
    const reconciliation = await startReconciliation(
      organizationId,
      {
        bankAccountId,
        statementEndingDate,
        statementEndingBalance,
        bankStatementImportId: typeof bankStatementImportId === 'string' ? bankStatementImportId : null,
        idFactory: () => crypto.randomUUID(),
      },
      ctx,
      dataAdapterMode,
    );
    return NextResponse.json({ reconciliation });
  } catch (error) {
    if (error instanceof BankingServiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
