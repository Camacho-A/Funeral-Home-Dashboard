import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { getRole, updateRole, deleteRole, RoleServiceError } from '@/services/roleService';
import { canManageRoles } from '@/services/authorizationPolicyService';
import { resolvePermissionKeysForRole } from '@/services/permissionService';
import { isPermissionKey } from '@/domain/rbac/permissionCatalog';

/**
 * Phase 22 (Role-Based Access Control). Renames/redescribes a custom role
 * and/or edits its permission set — the Role Editor's own save action.
 * `roleService.updateRole` itself refuses to act on a platform-default
 * role ("Platform default roles remain immutable" — clone it first
 * instead), surfaced here as a 409.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ roleId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const { roleId } = await params;
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { organizationId, name, description, addPermissions, removePermissions } = parsed.body;

  if (typeof organizationId !== 'string' || organizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (addPermissions !== undefined && (!Array.isArray(addPermissions) || !addPermissions.every(isPermissionKey))) {
    return NextResponse.json({ error: 'addPermissions must be an array of valid permission keys.' }, { status: 400 });
  }
  if (removePermissions !== undefined && (!Array.isArray(removePermissions) || !removePermissions.every(isPermissionKey))) {
    return NextResponse.json({ error: 'removePermissions must be an array of valid permission keys.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canManageRoles({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage roles for this organization.' }, { status: 403 });
  }

  const existing = await getRole(roleId, dataAdapterMode);
  // A platform-default role (organizationId: null) is visible to every
  // organization — not "not found" here — but updateRole/deleteRole
  // themselves refuse to act on it (409), matching "Platform default
  // roles remain immutable." Only a role genuinely owned by a DIFFERENT
  // organization is treated as not found.
  if (!existing || (existing.organizationId !== null && existing.organizationId !== authz.context.organizationId)) {
    return NextResponse.json({ error: 'Role not found.' }, { status: 404 });
  }

  try {
    const role = await updateRole(
      {
        roleId,
        name: typeof name === 'string' ? name : undefined,
        description: typeof description === 'string' ? description : undefined,
        addPermissions,
        removePermissions,
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

/**
 * Deletes a custom role. `roleService.deleteRole` refuses to act on a
 * platform default or on a role still assigned to an active member —
 * both surfaced here as 409, matching the same "reject with a clear
 * reason rather than silently orphaning a membership" behavior the
 * service itself documents.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ roleId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const { roleId } = await params;
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canManageRoles({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage roles for this organization.' }, { status: 403 });
  }

  const existing = await getRole(roleId, dataAdapterMode);
  // A platform-default role (organizationId: null) is visible to every
  // organization — not "not found" here — but updateRole/deleteRole
  // themselves refuse to act on it (409), matching "Platform default
  // roles remain immutable." Only a role genuinely owned by a DIFFERENT
  // organization is treated as not found.
  if (!existing || (existing.organizationId !== null && existing.organizationId !== authz.context.organizationId)) {
    return NextResponse.json({ error: 'Role not found.' }, { status: 404 });
  }

  try {
    await deleteRole({ roleId, actorIdentityId: identity.id, idFactory: () => crypto.randomUUID() }, dataAdapterMode);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof RoleServiceError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
