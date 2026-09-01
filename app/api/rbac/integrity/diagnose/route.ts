import { NextResponse } from 'next/server';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { canManageOrganization } from '@/services/authorizationPolicyService';
import { diagnoseRoleAuthorization, diagnoseMemberAuthorization } from '@/services/rbacIntegrityService';

/**
 * Phase 38. Read-only authorization diagnostic — "why is this role/member
 * unauthorized?". Query by `roleKey` OR `identityId` (within the caller's own
 * organization). Gated by `organization.manage`. The organization is always
 * resolved from the caller's authenticated membership context, never trusted
 * from the client. Returns no secrets and no cross-tenant data.
 */
export async function GET(request: Request) {
  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId');
  const roleKey = url.searchParams.get('roleKey');
  const identityId = url.searchParams.get('identityId');

  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (!roleKey && !identityId) {
    return NextResponse.json({ error: 'Provide either roleKey or identityId.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canManageOrganization({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to run authorization diagnostics.' }, { status: 403 });
  }

  // organizationId is always the server-resolved context value, never the raw
  // client-supplied string — tenant isolation for the diagnosis itself.
  const orgId = authz.context.organizationId;
  if (identityId) {
    const diagnosis = await diagnoseMemberAuthorization(identityId, orgId, dataAdapterMode);
    return NextResponse.json({ diagnosis });
  }
  const diagnosis = await diagnoseRoleAuthorization(roleKey as string, orgId, dataAdapterMode);
  return NextResponse.json({ diagnosis });
}
