import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { listRolesForOrganization, createCustomRole } from '@/services/roleService';
import { canManageRoles } from '@/services/authorizationPolicyService';
import { resolvePermissionKeysForRole } from '@/services/permissionService';
import { isPermissionKey } from '@/domain/rbac/permissionCatalog';

/**
 * Phase 22 (Role-Based Access Control). The Organization Roles Page's own
 * data source: every role (platform default + custom) currently enabled
 * for one organization — each with its resolved permission set attached,
 * so the Role Editor's Permission Matrix has what it needs without a
 * separate per-role request — and the endpoint for creating a brand-new
 * custom role from scratch (cloning an existing role instead is
 * `/api/rbac/roles/[roleId]/clone`).
 */
export async function GET(request: Request) {
  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identitySession, dataAdapterMode } = access;

  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }

  const roles = await listRolesForOrganization(authz.context.organizationId, dataAdapterMode);
  const rolesWithPermissions = await Promise.all(
    roles.map(async (role) => ({
      ...role,
      permissions: [...(await resolvePermissionKeysForRole(role.key, authz.context.organizationId, dataAdapterMode))].sort(),
    })),
  );
  return NextResponse.json({ roles: rolesWithPermissions });
}

export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId, name, description, permissions } = parsed.body;

  if (typeof organizationId !== 'string' || organizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  }
  if (!Array.isArray(permissions) || !permissions.every(isPermissionKey)) {
    return NextResponse.json({ error: 'permissions must be an array of valid permission keys.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canManageRoles({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage roles for this organization.' }, { status: 403 });
  }

  const role = await createCustomRole(
    {
      organizationId: authz.context.organizationId,
      name,
      description: typeof description === 'string' ? description : '',
      permissions,
      actorIdentityId: identity.id,
      idFactory: () => crypto.randomUUID(),
    },
    dataAdapterMode,
  );

  return NextResponse.json({ role: { ...role, permissions } });
}
