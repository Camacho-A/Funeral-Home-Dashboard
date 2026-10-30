import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { list } from '@/services/staffProfileService';
import { getDataAdapterMode } from '@/lib/env';

/**
 * The organization's active staff (2026-10) — who a task, case or
 * appointment can be assigned to, and whose name an assignee id displays
 * as. `hooks/useStaff.ts` used to call the staff profile service straight
 * from the browser, which only worked in mock mode (the Wix query needs
 * server credentials), so every assignee read "Office".
 *
 * Same authorization as `/api/staff/active-list`: authenticated membership
 * of the organization, re-derived from the session (the requested id is
 * never trusted). Only active profiles of that organization are returned —
 * assignment itself is still validated server-side by
 * `assertAssignableStaffProfile`.
 */
export async function GET(request: Request) {
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  try {
    const staff = await list(organizationId, getDataAdapterMode());
    return NextResponse.json({ staff: staff.filter((s) => s.organizationId === organizationId && s.isActive) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[GET /api/staff/profiles] failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not load staff.' }, { status: 502 });
  }
}
