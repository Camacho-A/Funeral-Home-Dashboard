import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canManageCalendar } from '@/services/authorizationPolicyService';
import { resolveStaffProfileForCaller } from '@/services/staffProfileService';
import { listConnectionsForOrganization, listConnectionsForStaffProfile } from '@/services/calendarConnectionService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Self-scoped by default — the caller's own connections,
 * resolved via `resolveStaffProfileForCaller`, mirroring
 * `NotificationPreference`'s own "no permission beyond authentication
 * needed for your own data" posture (§10/§19 of the plan). `?scope=
 * organization` additionally requires `calendar.manage` and returns
 * every connection in the organization, for the oversight view.
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

  if (url.searchParams.get('scope') === 'organization') {
    if (!(await canManageCalendar({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
      return NextResponse.json({ error: 'Not authorized to view calendar connections for this organization.' }, { status: 403 });
    }
    const connections = await listConnectionsForOrganization(organizationId, dataAdapterMode);
    return NextResponse.json({ connections });
  }

  const staffProfile = await resolveStaffProfileForCaller(authResult.context, dataAdapterMode);
  if (!staffProfile) {
    return NextResponse.json({ connections: [] });
  }
  const connections = await listConnectionsForStaffProfile(organizationId, staffProfile.id, dataAdapterMode);
  return NextResponse.json({ connections });
}
