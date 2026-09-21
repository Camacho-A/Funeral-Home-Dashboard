import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { canManageOrganization } from '@/services/authorizationPolicyService';
import { removeOverrideById } from '@/services/organizationRoleOverrideService';

/**
 * Manors go-live hardening. Removes one override, reverting that
 * `(roleKey, permissionKey)` tuple to pure base-role behavior.
 * `removeOverrideById` re-derives ownership from the fetched row itself —
 * an id belonging to a different organization is treated identically to
 * a nonexistent one (no-op), never distinguished to the caller, so this
 * route can never be used to probe another organization's override ids.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ overrideId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const { overrideId } = await params;
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canManageOrganization({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage role overrides for this organization.' }, { status: 403 });
  }

  await removeOverrideById(
    { organizationId: authz.context.organizationId, overrideId, actorIdentityId: identity.id, idFactory: () => crypto.randomUUID() },
    dataAdapterMode,
  );
  return NextResponse.json({ ok: true });
}
