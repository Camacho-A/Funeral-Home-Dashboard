import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { canManageOrganization } from '@/services/authorizationPolicyService';
import { listOverridesForOrganization, upsertOverride, RoleOverrideServiceError } from '@/services/organizationRoleOverrideService';

/**
 * Manors go-live hardening (2026-09). Management API for the
 * organization-scoped RBAC override layer (`types/organizationRolePermissionOverride.ts`).
 * Gated on `organization.manage` — the same narrowest-fit control already
 * used for `/api/rbac/integrity/*` — never `user.manageRoles` (that
 * permission governs editing a *role's own* grants; overrides are a
 * distinct, organization-settings-shaped concern layered on top of an
 * untouched role). Not exposed to Office Staff/Dispatch/Read Only in any
 * default role. `organizationId` is always the server-resolved,
 * membership-verified value — never the raw client-supplied string —
 * exactly like every other Route Handler in this codebase; an
 * administrator from a different organization can never reach another
 * organization's overrides through this route.
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
  if (!(await canManageOrganization({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view role overrides for this organization.' }, { status: 403 });
  }

  const overrides = await listOverridesForOrganization(authz.context.organizationId, dataAdapterMode);
  return NextResponse.json({ overrides });
}

/**
 * Creates a grant/revoke override, or updates an existing one for the
 * same `(roleKey, permissionKey)` tuple (flips `action` and/or `reason`
 * in place — `organizationRoleOverrideService.upsertOverride` never
 * creates a second row for the same tuple, by deterministic id).
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId, roleKey, permissionKey, action, reason } = parsed.body;

  if (typeof organizationId !== 'string' || organizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof roleKey !== 'string' || roleKey.trim().length === 0) {
    return NextResponse.json({ error: 'roleKey is required.' }, { status: 400 });
  }
  if (typeof permissionKey !== 'string' || permissionKey.trim().length === 0) {
    return NextResponse.json({ error: 'permissionKey is required.' }, { status: 400 });
  }
  if (action !== 'grant' && action !== 'revoke') {
    return NextResponse.json({ error: 'action must be "grant" or "revoke".' }, { status: 400 });
  }
  if (reason !== undefined && reason !== null && typeof reason !== 'string') {
    return NextResponse.json({ error: 'reason must be a string.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canManageOrganization({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage role overrides for this organization.' }, { status: 403 });
  }

  try {
    const override = await upsertOverride(
      {
        organizationId: authz.context.organizationId,
        roleKey,
        permissionKey,
        action,
        reason: reason ?? null,
        actorIdentityId: identity.id,
        idFactory: () => crypto.randomUUID(),
      },
      dataAdapterMode,
    );
    return NextResponse.json({ override });
  } catch (error) {
    if (error instanceof RoleOverrideServiceError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
