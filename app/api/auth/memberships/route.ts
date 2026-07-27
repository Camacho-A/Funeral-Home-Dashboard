import { NextResponse } from 'next/server';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { listMembershipsForIdentity, isActiveMembership } from '@/services/membershipService';
import { getOrganization } from '@/services/organizationProvisioningService';

/**
 * Phase 21 (Identity, Authentication & Session Management). Backs the
 * Organization Switcher — every organization this identity can currently
 * act in, plus which one the session is presently scoped to (from the
 * IdentitySession registry row, never the client). Not one of the spec's
 * own listed example routes, but required to render a switcher at all —
 * the same "routes list was illustrative, not exhaustive" precedent
 * app/api/onboarding/administrator/route.ts already established.
 */
export async function GET() {
  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identitySession, dataAdapterMode } = access;

  const memberships = (await listMembershipsForIdentity(identitySession.identityId, dataAdapterMode)).filter(isActiveMembership);

  const organizations = await Promise.all(
    memberships.map(async (m) => {
      const organization = await getOrganization(m.organizationId, dataAdapterMode);
      return {
        organizationId: m.organizationId,
        displayName: organization?.name ?? m.organizationId,
        role: m.role,
        isCurrent: m.organizationId === identitySession.organizationId,
      };
    }),
  );

  return NextResponse.json({ organizations });
}
