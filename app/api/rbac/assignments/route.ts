import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { getMembership } from '@/services/membershipService';
import { assignRole, removeRole, RoleServiceError } from '@/services/roleService';
import { canManageRoles } from '@/services/authorizationPolicyService';
import type { Membership } from '@/types/membership';
import type { DataAdapterMode } from '@/lib/env';

/**
 * Phase 22 (Role-Based Access Control). The Assign Role Dialog's own
 * endpoint: grants (`POST`) or removes (`DELETE`, falling back to
 * `readOnly`) a role for an existing member — never the caller's own
 * membership implicitly; `targetIdentityId` always names whose membership
 * is being changed, resolved server-side via `getMembership` rather than
 * trusting a client-supplied membershipId directly, exactly like
 * `/api/auth/invitations`'s regenerate endpoint re-derives the target
 * membership rather than trusting one by id alone.
 */
async function authorizeAndResolveTarget(
  body: Record<string, unknown>,
): Promise<
  | { ok: true; identityId: string; targetMembership: Membership; dataAdapterMode: DataAdapterMode }
  | { ok: false; response: NextResponse }
> {
  const access = await requireIdentitySession();
  if (!access.authorized) return { ok: false, response: access.response };
  const { identity, identitySession, dataAdapterMode } = access;

  const { organizationId, targetIdentityId } = body;

  if (typeof organizationId !== 'string' || organizationId.trim().length === 0) {
    return { ok: false, response: NextResponse.json({ error: 'organizationId is required.' }, { status: 400 }) };
  }
  if (typeof targetIdentityId !== 'string' || targetIdentityId.trim().length === 0) {
    return { ok: false, response: NextResponse.json({ error: 'targetIdentityId is required.' }, { status: 400 }) };
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return { ok: false, response: NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 }) };
  }
  if (!(await canManageRoles({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return { ok: false, response: NextResponse.json({ error: 'Not authorized to manage roles for this organization.' }, { status: 403 }) };
  }

  const targetMembership = await getMembership(targetIdentityId, authz.context.organizationId, dataAdapterMode);
  if (!targetMembership) {
    return { ok: false, response: NextResponse.json({ error: 'Membership not found.' }, { status: 404 }) };
  }

  return { ok: true, identityId: identity.id, targetMembership, dataAdapterMode };
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const resolved = await authorizeAndResolveTarget(parsed.body);
  if (!resolved.ok) return resolved.response;
  const { identityId, targetMembership, dataAdapterMode } = resolved;

  const { roleKey } = parsed.body;
  if (typeof roleKey !== 'string' || roleKey.trim().length === 0) {
    return NextResponse.json({ error: 'roleKey is required.' }, { status: 400 });
  }

  try {
    const { membership, auditEntry } = await assignRole(
      { membership: targetMembership, roleKey, actorIdentityId: identityId, idFactory: () => crypto.randomUUID() },
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

export async function DELETE(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const resolved = await authorizeAndResolveTarget(parsed.body);
  if (!resolved.ok) return resolved.response;
  const { identityId, targetMembership, dataAdapterMode } = resolved;

  try {
    const { membership, auditEntry } = await removeRole(
      { membership: targetMembership, actorIdentityId: identityId, idFactory: () => crypto.randomUUID() },
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
