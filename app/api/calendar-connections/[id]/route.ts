import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManageCalendar } from '@/services/authorizationPolicyService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { getConnectionById, disconnect, CalendarConnectionServiceError } from '@/services/calendarConnectionService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Disconnects a calendar connection — the owning staff
 * member (matched via `resolveStaffProfileForCaller`, never a raw
 * `staffProfileId` accepted from the client) or, for another staff
 * member's connection, a caller with `calendar.manage` (§18/§19 of the
 * plan). The Appointment/CalendarEventLink data this connection was
 * ever synced through is completely untouched — see
 * `calendarConnectionService.ts#disconnect`'s own comment.
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

  const connection = await getConnectionById(organizationId, id, dataAdapterMode);
  if (!connection) {
    return NextResponse.json({ error: 'Calendar connection not found.' }, { status: 404 });
  }

  const staffProfile = await resolveStaffProfileForCaller(authResult.context, dataAdapterMode);
  const isOwner = staffProfile?.id === connection.staffProfileId;
  if (!isOwner && !(await canManageCalendar({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to disconnect this calendar connection.' }, { status: 403 });
  }

  try {
    const disconnected = await disconnect(
      organizationId,
      id,
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      dataAdapterMode,
    );
    return NextResponse.json({ connection: disconnected });
  } catch (error) {
    if (error instanceof CalendarConnectionServiceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
