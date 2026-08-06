import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canManagePortal } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { listPortalAccessForCase } from '@/services/portal/portalAccessService';

/**
 * Phase 29 (Family Portal & External Collaboration). Staff-side, gated by
 * `portal.manage`. Lists every `PortalAccess` grant for this case
 * (pending/active/disabled/revoked/expired) — the staff-facing "who has
 * Family Portal access to this case" view.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canManagePortal({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage Family Portal access for this case.' }, { status: 403 });
  }

  const access = await listPortalAccessForCase(organizationId, caseId, dataAdapterMode);
  return NextResponse.json({ access });
}
