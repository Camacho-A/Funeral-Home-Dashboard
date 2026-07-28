import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { getMembership } from '@/services/membershipService';
import { setMembershipStatus, RoleServiceError } from '@/services/roleService';
import { canRemoveUser } from '@/services/authorizationPolicyService';
import type { MembershipStatus } from '@/types/membership';

const ALLOWED_STATUSES: MembershipStatus[] = ['active', 'disabled', 'removed'];

function isAllowedStatus(value: unknown): value is MembershipStatus {
  return typeof value === 'string' && (ALLOWED_STATUSES as string[]).includes(value);
}

/**
 * Phase 23 (Team Management). Exposes the already-guarded
 * `RoleService.setMembershipStatus` (disable/reactivate/remove) through an
 * authorized route — the service itself already enforces the
 * last-administrator invariant and the write-claim/fencing mechanism
 * (`commitProtectedWrite`); this route adds only what the service layer
 * can't: resolving/authorizing the caller, resolving the target membership
 * server-side (never trusting a client-supplied membership id directly —
 * same pattern as `/api/rbac/assignments`), and refusing a caller from
 * targeting their own membership (self-service disable/removal is out of
 * scope here regardless of admin count).
 *
 * `'invited'` is deliberately not an accepted `status` value — cancelling
 * a pending invitation is `DELETE /api/auth/invitations`'s job
 * (`revokeInvitation`), not this route's; `setMembershipStatus` itself
 * refuses to act on an `'invited'` membership for the same reason.
 */
export async function PATCH(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId, targetIdentityId, status } = parsed.body;

  if (typeof organizationId !== 'string' || organizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof targetIdentityId !== 'string' || targetIdentityId.trim().length === 0) {
    return NextResponse.json({ error: 'targetIdentityId is required.' }, { status: 400 });
  }
  if (!isAllowedStatus(status)) {
    return NextResponse.json({ error: 'status must be one of "active", "disabled", or "removed".' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canRemoveUser({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage membership status for this organization.' }, { status: 403 });
  }

  if (targetIdentityId === identity.id) {
    return NextResponse.json({ error: "You can't change your own membership status." }, { status: 400 });
  }

  const targetMembership = await getMembership(targetIdentityId, authz.context.organizationId, dataAdapterMode);
  if (!targetMembership) {
    return NextResponse.json({ error: 'Membership not found.' }, { status: 404 });
  }

  try {
    const { membership, auditEntry } = await setMembershipStatus(
      { membership: targetMembership, status, actorIdentityId: identity.id, idFactory: () => crypto.randomUUID() },
      dataAdapterMode,
    );
    return NextResponse.json({ membership, auditEntry });
  } catch (error) {
    if (error instanceof RoleServiceError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
