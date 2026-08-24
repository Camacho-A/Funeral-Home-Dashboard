import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageAccountsPayable } from '@/services/authorizationPolicyService';
import { voidVendorBill, AccountsPayableServiceError } from '@/services/accountsPayableService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 36. Void a vendor bill (ap.manage). Voiding REVERSES the bill's
 * journal entry via generalLedgerService.reverseJournalEntry — the posted
 * entry is never deleted, preserving immutable accounting history — and
 * reopens the billed receipts' GRNI.
 */
export async function POST(request: Request, { params }: { params: Promise<{ billId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const { billId } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (typeof body.organizationId !== 'string') return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const authResult = await requireAuthorizedOrganization(body.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canManageAccountsPayable({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage vendor bills.' }, { status: 403 });
  }
  const staffProfile = await resolveStaffProfileForCaller({ userId, organizationId, role }, dataAdapterMode);
  const ctx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    const bill = await voidVendorBill(organizationId, billId, ctx, dataAdapterMode, { reason: (body.reason as string | undefined) ?? undefined, performedByStaffProfileId: staffProfile?.id ?? null, idFactory: () => crypto.randomUUID() });
    return NextResponse.json({ bill });
  } catch (error) {
    if (error instanceof AccountsPayableServiceError) return NextResponse.json({ error: error.message }, { status: error.code === 'not_found' ? 404 : error.code === 'invalid_state' ? 409 : 400 });
    throw error;
  }
}
