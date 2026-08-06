import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManagePortal } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { revokeInvitation, PortalInvitationServiceError } from '@/services/portal/portalInvitationService';

/**
 * Phase 29 (Family Portal & External Collaboration). Cancels a still-
 * pending invitation and its linked (still-pending) `PortalAccess` grant
 * together — see `portalInvitationService.ts`'s own `revokeInvitation`
 * comment. Idempotent on an already-revoked invitation.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ caseId: string; invitationId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { invitationId } = await params;
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

  try {
    const invitation = await revokeInvitation(
      organizationId,
      invitationId,
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      dataAdapterMode,
    );
    return NextResponse.json({ invitation });
  } catch (error) {
    if (error instanceof PortalInvitationServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.message.includes('not found') ? 404 : 422 });
    }
    throw error;
  }
}
