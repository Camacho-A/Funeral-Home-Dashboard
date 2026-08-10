import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canPostJournalEntry } from '@/services/authorizationPolicyService';
import { reverseJournalEntry, getJournalEntryWithLines, GeneralLedgerServiceError, JournalEntryReversalError } from '@/services/generalLedgerService';
import { recordJournalEntryReversed } from '@/services/activityService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';

/** Phase 31. Reverses a posted entry — the only way to correct one; never
    mutates the original (see `reverseJournalEntry`'s own comment). Gated
    `accounting.post`. */
export async function POST(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { entryId } = await params;
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId: requestedOrganizationId, reason } = parsed.body;

  if (typeof requestedOrganizationId !== 'string' || requestedOrganizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return NextResponse.json({ error: 'reason is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canPostJournalEntry({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to reverse journal entries for this organization.' }, { status: 403 });
  }

  try {
    const staffProfile = await resolveStaffProfileForCaller(authResult.context, dataAdapterMode);
    const original = await getJournalEntryWithLines(organizationId, entryId, dataAdapterMode);
    const { entry, lines } = await reverseJournalEntry(
      organizationId,
      entryId,
      { reason, performedByStaffProfileId: staffProfile?.id ?? null, idFactory: () => crypto.randomUUID() },
      dataAdapterMode,
    );

    const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: entry.id };
    await recordJournalEntryReversed(ctx, entry.caseId, entry.id, original?.entry.entryNumber ?? entryId, dataAdapterMode);

    return NextResponse.json({ entry, lines });
  } catch (error) {
    if (error instanceof JournalEntryReversalError || error instanceof GeneralLedgerServiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
