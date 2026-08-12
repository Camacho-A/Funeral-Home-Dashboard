import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadSchedule } from '@/services/authorizationPolicyService';
import { listLinksForOrganization } from '@/services/calendarSyncService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Read-only visibility into `calendarEventLinks` for the
 * Calendar page's own sync-status indicator — gated by `schedule.read`,
 * the same permission that gates viewing appointments at all.
 */
export async function GET(request: Request) {
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canReadSchedule({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view calendar sync status for this organization.' }, { status: 403 });
  }

  const links = await listLinksForOrganization(organizationId, dataAdapterMode);
  return NextResponse.json({ links });
}
