import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canReadFinancials, canManageFinancials } from '@/services/authorizationPolicyService';
import { getJournalEntryWithLines, updateDraftJournalEntryLines, GeneralLedgerServiceError } from '@/services/generalLedgerService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 31. `GET` returns one entry + its lines (gated `accounting.view`);
    `PATCH` replaces a draft entry's lines wholesale (gated
    `accounting.manage`) — see `updateDraftJournalEntryLines`'s own
    comment on why this is the only mutation ever allowed, and only while
    `status === 'draft'`. */
export async function GET(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await params;
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

  const result = await getJournalEntryWithLines(organizationId, entryId, dataAdapterMode);
  if (!result) return NextResponse.json({ error: 'Journal entry not found.' }, { status: 404 });
  return NextResponse.json(result);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { entryId } = await params;
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId: requestedOrganizationId, lines } = parsed.body;

  if (typeof requestedOrganizationId !== 'string' || requestedOrganizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (
    !Array.isArray(lines) ||
    !lines.every(
      (l) =>
        l && typeof l === 'object' && typeof l.accountId === 'string' && (l.direction === 'debit' || l.direction === 'credit') && typeof l.amount === 'number',
    )
  ) {
    return NextResponse.json({ error: 'lines must be an array of { accountId, direction, amount }.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canManageFinancials({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage financial data for this organization.' }, { status: 403 });
  }

  try {
    const updatedLines = await updateDraftJournalEntryLines(
      organizationId,
      entryId,
      lines.map((l) => ({
        accountId: l.accountId,
        direction: l.direction,
        amount: l.amount,
        caseId: typeof l.caseId === 'string' ? l.caseId : null,
        description: typeof l.description === 'string' ? l.description : null,
      })),
      dataAdapterMode,
    );
    return NextResponse.json({ lines: updatedLines });
  } catch (error) {
    if (error instanceof GeneralLedgerServiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
