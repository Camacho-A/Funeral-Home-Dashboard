import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { getDataAdapterMode } from '@/lib/env';
import { canManageRoles } from '@/services/authorizationPolicyService';
import { issuePortalMfaSetupCode, PortalMfaSetupError } from '@/services/portalMfaSetupGrantService';
import { recordPortalMfaSetupCodeIssued } from '@/services/activityService';

/**
 * Portal-scoped MFA (Phase 5N follow-up). POST { organizationId, identityId }
 * — an administrator of that organization (`user.manageRoles`) issues a
 * one-time setup code so a member already protected by MFA in another SOLIS
 * portal can enroll in this one. Never for oneself. The code is returned
 * ONCE (Cache-Control: no-store) and only its hash is kept; the issue is
 * audited without the code.
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId, identityId } = parsed.body;
  if (typeof organizationId !== 'string' || typeof identityId !== 'string' || identityId.length === 0 || identityId.length > 200) {
    return NextResponse.json({ error: 'organizationId and identityId are required.' }, { status: 400 });
  }
  const authResult = await requireAuthorizedOrganization(organizationId);
  if (!authResult.authorized) return authResult.response;
  const { context } = authResult;
  const dataAdapterMode = getDataAdapterMode();
  if (!(await canManageRoles({ identityId: context.userId, organizationId: context.organizationId, roleKey: context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Only an administrator can issue a setup code.' }, { status: 403 });
  }
  try {
    const issued = await issuePortalMfaSetupCode(
      { actorIdentityId: context.userId, organizationId: context.organizationId, targetIdentityId: identityId, idFactory: () => crypto.randomUUID() },
      dataAdapterMode,
    );
    try {
      await recordPortalMfaSetupCodeIssued(
        { organizationId: context.organizationId, actorIdentityId: context.userId, actorMembershipId: null, actorRoleKey: context.role, correlationId: crypto.randomUUID() },
        { identityId, displayName: issued.targetDisplayName, expiresAt: issued.expiresAt },
        dataAdapterMode,
      );
    } catch (error) {
      console.error('Setup code issued but its Activity event was not recorded:', error instanceof Error ? error.message : error);
    }
    return NextResponse.json({ code: issued.code, expiresAt: issued.expiresAt }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof PortalMfaSetupError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
