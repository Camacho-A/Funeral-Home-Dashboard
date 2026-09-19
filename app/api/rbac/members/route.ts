import { NextResponse } from 'next/server';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { listMembershipsForOrganization } from '@/services/membershipService';
import { getIdentityById } from '@/services/identityService';
import { canReadTeamMembers } from '@/services/authorizationPolicyService';

/**
 * Phase 22 (Role-Based Access Control). Lists one organization's active
 * members with their current role — the Organization Roles Page's "who
 * currently holds this role" view, and the Assign Role Dialog's own
 * member picker.
 *
 * Manors go-live hardening (2026-09): previously any active member could
 * read this (documented at the time as "knowing who else is in your own
 * organization is not itself sensitive"). Production testing against a
 * live Office Staff account showed this exposed the full roster — names,
 * emails, roles, and status — to a role never meant to see it. Now
 * requires `user.read`; see that permission's own catalog comment for
 * who holds it and why. `user.manageRoles` is still required to actually
 * change anyone's role (`/api/rbac/assignments`).
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
  const { identity, identitySession, dataAdapterMode } = access;

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

  if (!(await canReadTeamMembers({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view team members for this organization.' }, { status: 403 });
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
