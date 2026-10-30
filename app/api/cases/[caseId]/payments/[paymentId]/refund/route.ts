import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canPostJournalEntry } from '@/services/authorizationPolicyService';
import { postRefundTransaction, FinancialTransactionServiceError } from '@/services/financialTransactionService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';
import { markCaseUnpaidAfterRefund } from '@/services/paymentWorkflow';

/**
 * Phase 31 (Financial Management & General Ledger). Refunds an
 * already-succeeded payment — closes the `payment.refund` permission's
 * long-reserved gap (named twice in ADR-034 as "not built here"). Nested
 * under the existing case-payments routes rather than `/api/accounting/*`
 * since a refund is fundamentally a case-payment action; gated
 * `accounting.post` (the same "post an irreversible financial
 * transaction" tier as journal-entry posting), not the pre-existing
 * `payment.refund` permission — see ADR-035's own note on why this phase
 * introduced a coarser `accounting.*` prefix rather than the older
 * fine-grained key.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string; paymentId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { caseId, paymentId } = await params;
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

  if (!(await canPostJournalEntry({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to refund payments for this organization.' }, { status: 403 });
  }

  try {
    const staffProfile = await resolveStaffProfileForCaller(authResult.context, dataAdapterMode);
    const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: paymentId };
    const entry = await postRefundTransaction(
      organizationId,
      { caseId, paymentId, postedByStaffProfileId: staffProfile?.id ?? null, idFactory: () => crypto.randomUUID() },
      ctx,
      dataAdapterMode,
    );
    // Payment status after a refund (2026-10): a refund that leaves a real
    // balance returns the case to "Awaiting payment". The refund itself has
    // already happened at the provider and in the ledger, so a failure here
    // never turns it into an error — the case page's payment summary still
    // shows the balance and says the stored status disagrees.
    let paymentStatus: 'reopened' | 'unchanged' | 'not_updated' = 'unchanged';
    try {
      paymentStatus = await markCaseUnpaidAfterRefund(organizationId, caseId, dataAdapterMode, ctx);
    } catch (error) {
      paymentStatus = 'not_updated';
      console.error('Refund succeeded but the case payment status was not updated:', error instanceof Error ? error.message : error);
    }
    return NextResponse.json({ entry, paymentStatus });
  } catch (error) {
    if (error instanceof FinancialTransactionServiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
