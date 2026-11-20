import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { getDataAdapterMode } from '@/lib/env';
import { canReadCases } from '@/services/authorizationPolicyService';
import { listUpcomingServices } from '@/services/upcomingServicesService';

/**
 * Gus Phase 5L. GET ?organizationId= → upcoming Viewings / Final Goodbyes
 * with preparation progress and release state (case.read). 404 for an
 * organization without service preparation. Read-only.
 */
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get('organizationId');
  if (!requested) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  const auth = await requireAuthorizedOrganization(requested);
  if (!auth.authorized) return auth.response;
  const { organizationId, userId, role } = auth.context;
  const mode = getDataAdapterMode();
  if (!(await canReadCases({ identityId: userId, organizationId, roleKey: role }, mode))) {
    return NextResponse.json({ error: 'Not authorized to view cases.' }, { status: 403 });
  }
  try {
    const services = await listUpcomingServices(organizationId, mode);
    if (!services) return NextResponse.json({ error: 'This funeral home has no service preparation.' }, { status: 404 });
    return NextResponse.json({ services }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Listing upcoming services failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not load upcoming services.' }, { status: 500 });
  }
}
