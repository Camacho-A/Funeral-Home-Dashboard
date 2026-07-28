import type { IdentitySession } from '@/types/identitySession';

/**
 * Phase 21 (Identity, Authentication & Session Management). Client-side
 * fetch wrappers around this app's own `/api/auth/*` Route Handlers —
 * the one place identity-mode UI (components/settings/SecuritySettingsPanel.tsx)
 * is allowed to reach the server, since `services/identityService.ts` and
 * friends import `lib/wixDataApi.ts` (a server-only module holding
 * WIX_API_KEY) and can never be imported into a Client Component directly
 * — unlike services/workflowTemplatesService.ts, which is safe to import
 * client-side because its own mock-mode branch never touches a secret.
 */

export type SessionListItem = IdentitySession & { isCurrent: boolean };

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

export async function fetchActiveSessions(): Promise<SessionListItem[]> {
  const response = await fetch('/api/auth/sessions');
  const body = await parseJsonOrThrow(response);
  return (body.sessions as SessionListItem[]) ?? [];
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  const response = await fetch(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  await parseJsonOrThrow(response);
}

export async function signOutEverywhere(): Promise<void> {
  const response = await fetch('/api/auth/sessions/sign-out-everywhere', { method: 'POST' });
  await parseJsonOrThrow(response);
}

export type MembershipListItem = {
  organizationId: string;
  displayName: string;
  role: string;
  isCurrent: boolean;
};

export async function fetchMyMemberships(): Promise<MembershipListItem[]> {
  const response = await fetch('/api/auth/memberships');
  const body = await parseJsonOrThrow(response);
  return (body.organizations as MembershipListItem[]) ?? [];
}

export async function switchOrganization(organizationId: string): Promise<void> {
  const response = await fetch('/api/auth/switch-organization', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  await parseJsonOrThrow(response);
}

export async function changePassword(params: {
  currentPassword: string;
  newPassword: string;
  keepCurrentSession: boolean;
}): Promise<{ signedOutEverywhere: boolean }> {
  const response = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrThrow(response);
  return { signedOutEverywhere: body.signedOutEverywhere === true };
}

/**
 * Phase 22 (Role-Based Access Control). Client-side fetch wrappers around
 * `/api/rbac/*` — the Organization Roles Page, Role Editor, Permission
 * Matrix, Assign Role Dialog, and Permission Inspector's only path to the
 * server, same reasoning as every wrapper above this comment.
 */
export type PermissionCatalogEntry = { key: string; category: string; description: string };
export type RbacRole = {
  id: string;
  key: string;
  name: string;
  description: string;
  organizationId: string | null;
  isSystemDefault: boolean;
  createdAt: string;
  updatedAt: string;
  /** This role's fully-resolved permission set — attached by
      GET /api/rbac/roles itself, not a field on the underlying Role
      record (see services/roleService.ts's Role type, which has no
      permissions field; permissions live in a separate join table). */
  permissions: string[];
};

export async function fetchPermissionCatalog(): Promise<PermissionCatalogEntry[]> {
  const response = await fetch('/api/rbac/permissions');
  const body = await parseJsonOrThrow(response);
  return (body.permissions as PermissionCatalogEntry[]) ?? [];
}

export async function fetchRolesForOrganization(organizationId: string): Promise<RbacRole[]> {
  const response = await fetch(`/api/rbac/roles?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await parseJsonOrThrow(response);
  return (body.roles as RbacRole[]) ?? [];
}

export async function fetchMyPermissions(organizationId: string): Promise<{ identityId: string; roleKey: string; permissions: string[] }> {
  const response = await fetch(`/api/rbac/my-permissions?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await parseJsonOrThrow(response);
  return { identityId: body.identityId as string, roleKey: body.roleKey as string, permissions: (body.permissions as string[]) ?? [] };
}

export async function createCustomRole(params: { organizationId: string; name: string; description?: string; permissions: string[] }): Promise<RbacRole> {
  const response = await fetch('/api/rbac/roles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrThrow(response);
  return body.role as RbacRole;
}

export async function cloneRoleRequest(params: { roleId: string; organizationId: string; name: string; description?: string }): Promise<RbacRole> {
  const response = await fetch(`/api/rbac/roles/${encodeURIComponent(params.roleId)}/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: params.organizationId, name: params.name, description: params.description }),
  });
  const body = await parseJsonOrThrow(response);
  return body.role as RbacRole;
}

export async function updateRoleRequest(params: {
  roleId: string;
  organizationId: string;
  name?: string;
  description?: string;
  addPermissions?: string[];
  removePermissions?: string[];
}): Promise<RbacRole> {
  const { roleId, ...body } = params;
  const response = await fetch(`/api/rbac/roles/${encodeURIComponent(roleId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseBody = await parseJsonOrThrow(response);
  return responseBody.role as RbacRole;
}

export async function deleteRoleRequest(params: { roleId: string; organizationId: string }): Promise<void> {
  const response = await fetch(`/api/rbac/roles/${encodeURIComponent(params.roleId)}?organizationId=${encodeURIComponent(params.organizationId)}`, {
    method: 'DELETE',
  });
  await parseJsonOrThrow(response);
}

export async function assignRoleToMember(params: { organizationId: string; targetIdentityId: string; roleKey: string }): Promise<void> {
  const response = await fetch('/api/rbac/assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  await parseJsonOrThrow(response);
}

export async function removeRoleFromMember(params: { organizationId: string; targetIdentityId: string }): Promise<void> {
  const response = await fetch('/api/rbac/assignments', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  await parseJsonOrThrow(response);
}

export type RbacMember = {
  identityId: string;
  displayName: string;
  email: string | null;
  role: string;
  membershipId: string;
  /** Phase 23 (Team Management): present when `includeDisabled` is passed —
      `'active'` for every row when it isn't (the endpoint's original,
      unchanged default). */
  status?: 'active' | 'disabled';
};

export async function fetchOrganizationMembers(organizationId: string, includeDisabled = false): Promise<RbacMember[]> {
  const params = new URLSearchParams({ organizationId });
  if (includeDisabled) params.set('includeDisabled', 'true');
  const response = await fetch(`/api/rbac/members?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return (body.members as RbacMember[]) ?? [];
}

/**
 * Phase 23 (Team Management). Client-side fetch wrappers around the three
 * prerequisite backend additions: `GET`/`DELETE /api/auth/invitations` and
 * `PATCH /api/rbac/membership-status` — same reasoning as every wrapper
 * above this comment.
 */
export type PendingInvitation = {
  membershipId: string;
  identityId: string;
  email: string;
  displayName: string;
  role: string;
  status: 'pending' | 'expired';
  createdAt: string;
  expiresAt: string | null;
  lastResentAt: string | null;
};

export async function fetchPendingInvitations(organizationId: string): Promise<PendingInvitation[]> {
  const response = await fetch(`/api/auth/invitations?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await parseJsonOrThrow(response);
  return (body.invitations as PendingInvitation[]) ?? [];
}

export async function inviteTeamMember(params: { organizationId: string; email: string; displayName: string; role: string }): Promise<{ membershipId: string; isNewMembership: boolean }> {
  const response = await fetch('/api/auth/invitations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrThrow(response);
  const membership = body.membership as { id: string } | undefined;
  return { membershipId: membership?.id ?? '', isNewMembership: body.isNewMembership === true };
}

export async function resendInvitationRequest(params: { organizationId: string; membershipId: string; invitedIdentityId: string }): Promise<void> {
  const response = await fetch('/api/auth/invitations', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  await parseJsonOrThrow(response);
}

export async function revokeInvitationRequest(params: { organizationId: string; membershipId: string }): Promise<void> {
  const response = await fetch('/api/auth/invitations', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  await parseJsonOrThrow(response);
}

export type MembershipStatusValue = 'active' | 'disabled' | 'removed';

export async function setMembershipStatusRequest(params: { organizationId: string; targetIdentityId: string; status: MembershipStatusValue }): Promise<void> {
  const response = await fetch('/api/rbac/membership-status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  await parseJsonOrThrow(response);
}
