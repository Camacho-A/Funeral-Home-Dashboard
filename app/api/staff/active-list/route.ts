import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { listDistinctActiveStaffForOrganization } from '@/services/sessionService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * Backs the sidebar's "N staff online" hover popover — the names behind
 * `/api/staff/active-count`'s own number. Same authorization
 * (`requireAuthorizedOrganization`, no permission beyond authenticated
 * membership) as that route; returns only `{ displayName, roleKey }` per
 * distinct active identity, never email or id. Fetched only when the
 * popover opens (see `Sidebar.tsx`), not on every render alongside the
 * count.
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

  const staff = await listDistinctActiveStaffForOrganization(organizationId, dataAdapterMode);
  return NextResponse.json({ staff });
}
