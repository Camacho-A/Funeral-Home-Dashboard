import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManagePortal } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { issueInvitation, listPendingInvitationsForCase, PortalInvitationServiceError } from '@/services/portal/portalInvitationService';
import { isValidPortalRelationshipType, PORTAL_RELATIONSHIP_TYPES } from '@/domain/portal/portalRelationshipRegistry';
import { isValidEmailShape } from '@/domain/identity/email';
import { getIdentityMessageSender } from '@/lib/identity/messageSender';

/**
 * Phase 29 (Family Portal & External Collaboration). Staff-side —
 * gated by `portal.manage`, exactly like every other staff RBAC-checked
 * case route. Delegates entirely to `services/portal/portalInvitationService.ts`;
 * the raw invitation token is never returned in this response body — it
 * flows only into `getIdentityMessageSender().send(...)`, mirroring every
 * other token-issuing route in this codebase (see
 * `lib/identity/messageSender.ts`'s own header comment).
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

  const invitations = await listPendingInvitationsForCase(organizationId, caseId, dataAdapterMode);
  return NextResponse.json({ invitations });
}

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { caseId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; email?: unknown; displayName?: unknown; relationshipType?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof b.email !== 'string' || !isValidEmailShape(b.email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }
  if (typeof b.displayName !== 'string' || !b.displayName.trim()) {
    return NextResponse.json({ error: 'displayName is required.' }, { status: 400 });
  }
  if (typeof b.relationshipType !== 'string' || !isValidPortalRelationshipType(b.relationshipType)) {
    return NextResponse.json({ error: 'A valid relationshipType is required.' }, { status: 400 });
  }
  if (!PORTAL_RELATIONSHIP_TYPES[b.relationshipType].implemented) {
    return NextResponse.json({ error: `relationshipType "${b.relationshipType}" is reserved and not yet available.` }, { status: 422 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canManagePortal({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage Family Portal access for this case.' }, { status: 403 });
  }

  try {
    const { invitation, rawToken } = await issueInvitation(
      { organizationId, caseId, email: b.email, displayName: b.displayName, relationshipType: b.relationshipType, idFactory: () => crypto.randomUUID() },
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      dataAdapterMode,
    );

    try {
      await getIdentityMessageSender().send({
        kind: 'portal_invitation',
        to: invitation.email,
        token: rawToken,
        organizationId,
        caseId,
        invitationId: invitation.id,
      });
    } catch (error) {
      console.error('Failed to send Family Portal invitation email:', error instanceof Error ? error.message : error);
    }

    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    if (error instanceof PortalInvitationServiceError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
