import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canPostJournalEntry } from '@/services/authorizationPolicyService';
import { voidDraftJournalEntry, GeneralLedgerServiceError } from '@/services/generalLedgerService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 31. Voids (discards) a draft entry — the only way to discard
    one; gated `accounting.post` alongside posting itself, per ADR-035's
    RBAC tier split. A posted entry is never voided, only reversed (see
    `.../reverse`). */
export async function POST(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { entryId } = await params;
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
    return NextResponse.json({ error: 'Not authorized to void journal entries for this organization.' }, { status: 403 });
  }

  try {
    const entry = await voidDraftJournalEntry(organizationId, entryId, dataAdapterMode);
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof GeneralLedgerServiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
