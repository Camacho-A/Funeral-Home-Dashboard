import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canPostJournalEntry } from '@/services/authorizationPolicyService';
import { postTransferTransaction, FinancialTransactionServiceError } from '@/services/financialTransactionService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 31. Posts a transfer (Dr destination / Cr source) between two
    ledger accounts — e.g. moving cash between two bank accounts' own
    Cash-type accounts. Gated `accounting.post`. */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId: requestedOrganizationId, sourceAccountId, destinationAccountId, amountCents, memo } = parsed.body;

  if (typeof requestedOrganizationId !== 'string' || requestedOrganizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof sourceAccountId !== 'string' || sourceAccountId.trim().length === 0) {
    return NextResponse.json({ error: 'sourceAccountId is required.' }, { status: 400 });
  }
  if (typeof destinationAccountId !== 'string' || destinationAccountId.trim().length === 0) {
    return NextResponse.json({ error: 'destinationAccountId is required.' }, { status: 400 });
  }
  if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: 'amountCents must be a positive integer.' }, { status: 400 });
  }
  if (typeof memo !== 'string' || memo.trim().length === 0) {
    return NextResponse.json({ error: 'memo is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canPostJournalEntry({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to post transfers for this organization.' }, { status: 403 });
  }

  try {
    const staffProfile = await resolveStaffProfileForCaller(authResult.context, dataAdapterMode);
    const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
    const entry = await postTransferTransaction(
      organizationId,
      { sourceAccountId, destinationAccountId, amountCents, memo, performedByStaffProfileId: staffProfile?.id ?? null, idFactory: () => crypto.randomUUID() },
      ctx,
      dataAdapterMode,
    );
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof FinancialTransactionServiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
