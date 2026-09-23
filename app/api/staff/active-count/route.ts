import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { countDistinctActiveStaffForOrganization } from '@/services/sessionService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Backs the sidebar's "N staff online" count — always a fresh, live query
 * (mirrors `/api/notifications/unread-count`'s own posture), never a
 * client-cached running total. No permission beyond authenticated
 * membership: this is an aggregate count only, never any per-session
 * detail (device, IP, user agent) — see `countDistinctActiveStaffForOrganization`'s
 * own comment for exactly what "active" means here.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  const count = await countDistinctActiveStaffForOrganization(organizationId, dataAdapterMode);
  return NextResponse.json({ count });
}
