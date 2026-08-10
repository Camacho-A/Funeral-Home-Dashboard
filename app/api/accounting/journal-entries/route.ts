import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canReadFinancials, canManageFinancials } from '@/services/authorizationPolicyService';
import { listJournalEntriesForOrganization, createDraftJournalEntry, updateDraftJournalEntryLines, GeneralLedgerServiceError } from '@/services/generalLedgerService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 31 (Financial Management & General Ledger). `GET` lists journal
 * entry headers (optionally date-filtered) — gated `accounting.view`.
 * `POST` creates a new `manual`-source draft entry with its lines already
 * composed (never posted here — see `.../[entryId]/post`) — gated
 * `accounting.manage`, mirroring `canPostJournalEntry`'s own separate
 * "prepare vs. post" tier split.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
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

  const fromDate = url.searchParams.get('fromDate') ?? undefined;
  const toDate = url.searchParams.get('toDate') ?? undefined;
  const entries = await listJournalEntriesForOrganization(organizationId, dataAdapterMode, { fromDate, toDate });
  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId: requestedOrganizationId, entryDate, memo, caseId, lines } = parsed.body;

  if (typeof requestedOrganizationId !== 'string' || requestedOrganizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof entryDate !== 'string' || entryDate.trim().length === 0) {
    return NextResponse.json({ error: 'entryDate is required.' }, { status: 400 });
  }
  if (typeof memo !== 'string' || memo.trim().length === 0) {
    return NextResponse.json({ error: 'memo is required.' }, { status: 400 });
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
    const entry = await createDraftJournalEntry(
      organizationId,
      { entryDate, memo, caseId: typeof caseId === 'string' ? caseId : null, idFactory: () => crypto.randomUUID() },
      dataAdapterMode,
    );
    const insertedLines = await updateDraftJournalEntryLines(
      organizationId,
      entry.id,
      lines.map((l) => ({
        accountId: l.accountId,
        direction: l.direction,
        amount: l.amount,
        caseId: typeof l.caseId === 'string' ? l.caseId : null,
        description: typeof l.description === 'string' ? l.description : null,
      })),
      dataAdapterMode,
    );
    return NextResponse.json({ entry, lines: insertedLines });
  } catch (error) {
    if (error instanceof GeneralLedgerServiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
