import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canReconcileBank } from '@/services/authorizationPolicyService';
import { importBankStatement, runAutoMatch, BankingServiceError } from '@/services/bankingService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 31. Imports a bank statement's already-parsed lines as
    `unmatched` `BankStatementLine`s — gated `accounting.reconcile`. */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId: requestedOrganizationId, bankAccountId, fileName, statementPeriodStart, statementPeriodEnd, lines } = parsed.body;

  if (typeof requestedOrganizationId !== 'string' || requestedOrganizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof bankAccountId !== 'string' || bankAccountId.trim().length === 0) {
    return NextResponse.json({ error: 'bankAccountId is required.' }, { status: 400 });
  }
  if (
    !Array.isArray(lines) ||
    !lines.every((l) => l && typeof l === 'object' && typeof l.transactionDate === 'string' && typeof l.description === 'string' && typeof l.amount === 'number')
  ) {
    return NextResponse.json({ error: 'lines must be an array of { transactionDate, description, amount }.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReconcileBank({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to import bank statements for this organization.' }, { status: 403 });
  }

  try {
    const staffProfile = await resolveStaffProfileForCaller(authResult.context, dataAdapterMode);
    const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
    const result = await importBankStatement(
      organizationId,
      {
        bankAccountId,
        fileName: typeof fileName === 'string' ? fileName : null,
        statementPeriodStart: typeof statementPeriodStart === 'string' ? statementPeriodStart : null,
        statementPeriodEnd: typeof statementPeriodEnd === 'string' ? statementPeriodEnd : null,
        lines,
        createdByStaffProfileId: staffProfile?.id ?? null,
        idFactory: () => crypto.randomUUID(),
      },
      ctx,
      dataAdapterMode,
    );
    // Immediately attempt auto-match — the ordinary next step of an import,
    // per bankingService.ts's own matching algorithm; a human still
    // reviews/manually resolves whatever it leaves unmatched.
    const { matchedCount, lines: matchedLines } = await runAutoMatch(organizationId, bankAccountId, dataAdapterMode);
    return NextResponse.json({ ...result, lines: matchedLines, autoMatchedCount: matchedCount });
  } catch (error) {
    if (error instanceof BankingServiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
