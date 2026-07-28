import { NextResponse } from 'next/server';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { listMembershipsForOrganization } from '@/services/membershipService';
import { getIdentityById } from '@/services/identityService';

/**
 * Phase 22 (Role-Based Access Control). Lists one organization's active
 * members with their current role — the Organization Roles Page's "who
 * currently holds this role" view, and the Assign Role Dialog's own
 * member picker. Any active member may read this (matching
 * `GET /api/rbac/roles`'s own "any active member may list roles" —
 * knowing who else is in your own organization is not itself sensitive);
 * only `user.manageRoles` is required to actually change anyone's role
 * (`/api/rbac/assignments`).
 *
 * Phase 23 (Team Management): an optional `includeDisabled=true` query
 * param also includes `status: 'disabled'` memberships (each now carries
 * its own `status` field) — the Team page's own member list needs to show
 * disabled members so it can offer a "reactivate" action for them.
 * Omitting the param preserves the exact original response shape and
 * behavior (active members only) for every existing caller — the
 * Organization Roles Page's own member picker doesn't need to change.
 */
export async function GET(request: Request) {
  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identitySession, dataAdapterMode } = access;

  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  const includeDisabled = url.searchParams.get('includeDisabled') === 'true';

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }

  const allMemberships = await listMembershipsForOrganization(authz.context.organizationId, dataAdapterMode);
  const memberships = allMemberships.filter((m) => m.status === 'active' || (includeDisabled && m.status === 'disabled'));
  const members = await Promise.all(
    memberships.map(async (membership) => {
      const memberIdentity = await getIdentityById(membership.identityId, dataAdapterMode);
      return {
        identityId: membership.identityId,
        displayName: memberIdentity?.displayName ?? membership.identityId,
        email: memberIdentity?.email ?? null,
        role: membership.role,
        membershipId: membership.id,
        status: membership.status,
      };
    }),
  );

  return NextResponse.json({ members });
}
