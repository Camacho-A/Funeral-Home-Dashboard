import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { inviteToOrganization, regenerateInvitation, listPendingInvitations, revokeInvitation } from '@/services/invitationService';
import { getMembership } from '@/services/membershipService';
import { getIdentityById } from '@/services/identityService';
import { getIdentityMessageSender } from '@/lib/identity/messageSender';
import { resolveRoleForKey } from '@/services/permissionService';
import { canInviteUser } from '@/services/authorizationPolicyService';

/**
 * Phase 21 (Identity, Authentication & Session Management). "Organization
 * Administrator -> Invite Staff": only a caller authorized to invite may
 * invite anyone into it. Only a caller whose own active Membership in the
 * target organization is owner/administrator-tier may invite anyone into
 * it — an ordinary staff/caseManager/readOnly member cannot, matching the
 * same admin-tier gate lib/auth/authorize.ts's hasAdminTierMembership
 * enforces for the older mock/wix model's onboarding routes.
 *
 * Phase 22 (Role-Based Access Control) migration: the gate and the role
 * value itself are no longer checked against a hardcoded role-name list.
 * `canInviteUser` resolves the caller's *actual* permission
 * (`user.invite`) — granted to `administrator` and `manager` by default,
 * same effective behavior as the old owner/administrator-only gate for
 * every pre-existing role value, but now also correctly extends to
 * whichever roles an organization's own custom role configuration grants
 * it to. The invited `role` itself is validated by resolving it for this
 * organization (`resolveRoleForKey`) — accepting any of the legacy values,
 * a Phase 22 default role key, or one of this organization's own custom
 * roles, instead of a fixed five-value list.
 *
 * Security correction (2026-07-25): the raw invitation token used to be
 * returned directly in this response. See
 * app/api/auth/forgot-password/route.ts's own comment — same fix, same
 * reasoning, applied here. Unlike forgot-password, this is an
 * authenticated admin action (the caller already knows who they're
 * inviting), so there's no "never reveal whether an identity exists"
 * concern for the *response* — the token itself still must never appear
 * in it.
 *
 * Phase 23 (Team Management): `GET` (list pending invitations) and
 * `DELETE` (revoke a pending invitation) added — gated by the same
 * `canInviteUser` check as `POST`/`PATCH`, since managing invitations is
 * one coherent permission surface.
 */
export async function GET(request: Request) {
  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canInviteUser({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view invitations for this organization.' }, { status: 403 });
  }

  const invitations = await listPendingInvitations(authz.context.organizationId, dataAdapterMode);
  return NextResponse.json({ invitations });
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId, email, displayName, role } = parsed.body;

  if (typeof organizationId !== 'string' || organizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof email !== 'string' || email.trim().length === 0) {
    return NextResponse.json({ error: 'email is required.' }, { status: 400 });
  }
  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    return NextResponse.json({ error: 'displayName is required.' }, { status: 400 });
  }
  if (typeof role !== 'string' || !(await resolveRoleForKey(role, organizationId, dataAdapterMode))) {
    return NextResponse.json({ error: 'role must be a valid role for this organization.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canInviteUser({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to invite members to this organization.' }, { status: 403 });
  }

  const result = await inviteToOrganization(
    {
      email,
      displayName,
      organizationId: authz.context.organizationId,
      role,
      invitedByIdentityId: identity.id,
      idFactory: () => crypto.randomUUID(),
    },
    dataAdapterMode,
  );

  if (result.verificationToken) {
    try {
      await getIdentityMessageSender().send({
        kind: 'invitation',
        to: result.identity.email,
        token: result.verificationToken,
        organizationId: authz.context.organizationId,
        membershipId: result.membership.id,
      });
    } catch (error) {
      console.error('Failed to send invitation message:', error instanceof Error ? error.message : error);
    }
  }

  return NextResponse.json({
    membership: result.membership,
    isNewMembership: result.isNewMembership,
  });
}

/** "Expired invitations may be regenerated." */
export async function PATCH(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId, membershipId, invitedIdentityId } = parsed.body;

  if (typeof organizationId !== 'string' || organizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof membershipId !== 'string' || membershipId.trim().length === 0) {
    return NextResponse.json({ error: 'membershipId is required.' }, { status: 400 });
  }
  if (typeof invitedIdentityId !== 'string' || invitedIdentityId.trim().length === 0) {
    return NextResponse.json({ error: 'invitedIdentityId is required.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canInviteUser({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage invitations for this organization.' }, { status: 403 });
  }

  // regenerateInvitation only needs identityId internally (it re-issues an
  // identity-scoped email-verification token, not an org-scoped one) — so
  // the security boundary that actually matters here is confirmed
  // independently: does invitedIdentityId genuinely have a membership row
  // (this exact membershipId) in the organization the caller is authorized
  // for? Without this check, an admin of one organization could regenerate
  // a token for any identityId they merely guessed, regardless of whether
  // that person was ever invited to *this* organization.
  const membership = await getMembership(invitedIdentityId, authz.context.organizationId, dataAdapterMode);
  if (!membership || membership.id !== membershipId) {
    return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 });
  }

  const { token } = await regenerateInvitation(membershipId, invitedIdentityId, () => crypto.randomUUID(), dataAdapterMode);

  const invitedIdentity = await getIdentityById(invitedIdentityId, dataAdapterMode);
  if (invitedIdentity) {
    try {
      await getIdentityMessageSender().send({
        kind: 'invitation',
        to: invitedIdentity.email,
        token,
        organizationId: authz.context.organizationId,
        membershipId,
      });
    } catch (error) {
      console.error('Failed to send invitation message:', error instanceof Error ? error.message : error);
    }
  }

  return NextResponse.json({ ok: true });
}

/** Revokes a still-pending invitation — see `revokeInvitation`'s own
    comment for the exact idempotency/already-accepted semantics. */
export async function DELETE(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId, membershipId } = parsed.body;

  if (typeof organizationId !== 'string' || organizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof membershipId !== 'string' || membershipId.trim().length === 0) {
    return NextResponse.json({ error: 'membershipId is required.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canInviteUser({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage invitations for this organization.' }, { status: 403 });
  }

  const result = await revokeInvitation(
    { organizationId: authz.context.organizationId, membershipId, actorIdentityId: identity.id, idFactory: () => crypto.randomUUID() },
    dataAdapterMode,
  );

  switch (result.outcome) {
    case 'revoked':
    case 'already_revoked':
      return NextResponse.json({ ok: true, membership: result.membership });
    case 'already_accepted':
      return NextResponse.json({ error: 'This invitation has already been accepted.' }, { status: 409 });
    case 'not_found':
      return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 });
  }
}
