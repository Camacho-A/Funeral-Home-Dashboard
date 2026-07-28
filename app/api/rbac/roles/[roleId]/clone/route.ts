import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { cloneRole, RoleServiceError } from '@/services/roleService';
import { canManageRoles } from '@/services/authorizationPolicyService';
import { resolvePermissionKeysForRole } from '@/services/permissionService';

/**
 * Phase 22 (Role-Based Access Control). "Organizations may clone a
 * default role" — also usable to clone one of the organization's own
 * existing custom roles. The source role (platform default or this
 * organization's own) is never modified; the result is a brand-new,
 * independently editable custom role.
 */
export async function POST(request: Request, { params }: { params: Promise<{ roleId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const { roleId } = await params;
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId, name, description } = parsed.body;

  if (typeof organizationId !== 'string' || organizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canManageRoles({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage roles for this organization.' }, { status: 403 });
  }

  try {
    const role = await cloneRole(
      {
        organizationId: authz.context.organizationId,
        sourceRoleId: roleId,
        name,
        description: typeof description === 'string' ? description : undefined,
        actorIdentityId: identity.id,
        idFactory: () => crypto.randomUUID(),
      },
      dataAdapterMode,
    );
    const permissions = [...(await resolvePermissionKeysForRole(role.key, authz.context.organizationId, dataAdapterMode))].sort();
    return NextResponse.json({ role: { ...role, permissions } });
  } catch (error) {
    if (error instanceof RoleServiceError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
