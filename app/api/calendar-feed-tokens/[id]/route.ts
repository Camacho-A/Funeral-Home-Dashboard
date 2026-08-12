import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageCalendar } from '@/services/authorizationPolicyService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getFeedTokenById, revokeFeedToken, CalendarFeedTokenServiceError } from '@/services/calendarFeedTokenService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Revokes a feed token — the owning staff member, or an
 * administrator/manager via `calendar.manage`, mirroring
 * `app/api/calendar-connections/[id]/route.ts`'s exact ownership check
 * shape. Revocation takes effect immediately — the next feed pull with
 * this token resolves to 404 (`resolveFeedToken` treats a revoked token
 * identically to a nonexistent one).
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { id } = await params;
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  const token = await getFeedTokenById(id, dataAdapterMode);
  if (!token || token.organizationId !== organizationId) {
    return NextResponse.json({ error: 'Calendar feed token not found.' }, { status: 404 });
  }

  const staffProfile = await resolveStaffProfileForCaller(authResult.context, dataAdapterMode);
  const isOwner = staffProfile?.id === token.ownerStaffProfileId;
  if (!isOwner && !(await canManageCalendar({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to revoke this calendar feed token.' }, { status: 403 });
  }

  try {
    const revoked = await revokeFeedToken(organizationId, id, dataAdapterMode);
    return NextResponse.json({ token: revoked });
  } catch (error) {
    if (error instanceof CalendarFeedTokenServiceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
