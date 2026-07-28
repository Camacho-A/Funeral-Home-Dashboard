import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchPermissionCatalog,
  fetchRolesForOrganization,
  fetchMyPermissions,
  fetchOrganizationMembers,
  createCustomRole,
  cloneRoleRequest,
  updateRoleRequest,
  deleteRoleRequest,
  assignRoleToMember,
  removeRoleFromMember,
  fetchPendingInvitations,
  inviteTeamMember,
  resendInvitationRequest,
  revokeInvitationRequest,
  setMembershipStatusRequest,
  type MembershipStatusValue,
} from '@/lib/identityAuthClient';

/**
 * Phase 22 (Role-Based Access Control). Query/mutation hooks for
 * `/api/rbac/*` — the Organization Roles Page, Role Editor, Permission
 * Matrix, Assign Role Dialog, and Permission Inspector's data layer.
 * Bundled in one file the same way `hooks/useIdentitySessions.ts` bundles
 * its own closely-related query + mutations, since every mutation here
 * invalidates the same `rolesForOrganization` cache entry.
 */
const permissionCatalogKey = ['rbacPermissionCatalog'];
const rolesKey = (organizationId: string) => ['rbacRoles', organizationId];
const myPermissionsKey = (organizationId: string) => ['rbacMyPermissions', organizationId];
/** The plain `['rbacMembers', organizationId]` prefix — used for
    invalidation, since TanStack Query's `invalidateQueries` matches any
    cached key starting with the given array, so invalidating this shorter
    prefix clears both the plain and `includeDisabled` query-key variants
    below at once. */
const membersKeyPrefix = (organizationId: string) => ['rbacMembers', organizationId];
const membersKey = (organizationId: string, includeDisabled = false) => [...membersKeyPrefix(organizationId), includeDisabled];
const pendingInvitationsKey = (organizationId: string) => ['rbacPendingInvitations', organizationId];

export function usePermissionCatalog() {
  return useQuery({ queryKey: permissionCatalogKey, queryFn: fetchPermissionCatalog, staleTime: Infinity });
}

export function useRoles(organizationId: string) {
  return useQuery({ queryKey: rolesKey(organizationId), queryFn: () => fetchRolesForOrganization(organizationId), enabled: Boolean(organizationId) });
}

export function useMyPermissions(organizationId: string) {
  return useQuery({ queryKey: myPermissionsKey(organizationId), queryFn: () => fetchMyPermissions(organizationId), enabled: Boolean(organizationId) });
}

export function useOrganizationMembers(organizationId: string, includeDisabled = false) {
  return useQuery({
    queryKey: membersKey(organizationId, includeDisabled),
    queryFn: () => fetchOrganizationMembers(organizationId, includeDisabled),
    enabled: Boolean(organizationId),
  });
}

export function useCreateCustomRole(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { name: string; description?: string; permissions: string[] }) => createCustomRole({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rolesKey(organizationId) }),
  });
}

export function useCloneRole(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { roleId: string; name: string; description?: string }) => cloneRoleRequest({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rolesKey(organizationId) }),
  });
}

export function useUpdateRole(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { roleId: string; name?: string; description?: string; addPermissions?: string[]; removePermissions?: string[] }) =>
      updateRoleRequest({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rolesKey(organizationId) }),
  });
}

export function useDeleteRole(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) => deleteRoleRequest({ organizationId, roleId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rolesKey(organizationId) }),
  });
}

export function useAssignRole(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { targetIdentityId: string; roleKey: string }) => assignRoleToMember({ organizationId, ...params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: myPermissionsKey(organizationId) });
      queryClient.invalidateQueries({ queryKey: membersKeyPrefix(organizationId) });
    },
  });
}

export function useRemoveRole(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { targetIdentityId: string }) => removeRoleFromMember({ organizationId, ...params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: myPermissionsKey(organizationId) });
      queryClient.invalidateQueries({ queryKey: membersKeyPrefix(organizationId) });
    },
  });
}

/**
 * Phase 23 (Team Management). Query/mutation hooks for the Team page's own
 * data layer — pending invitations plus the three prerequisite mutations
 * (invite, resend, revoke, and membership-status change), bundled here
 * alongside the rest of `/api/rbac/*`'s hooks for the same reason the
 * Phase 22 hooks above are all in one file.
 */
export function usePendingInvitations(organizationId: string) {
  return useQuery({ queryKey: pendingInvitationsKey(organizationId), queryFn: () => fetchPendingInvitations(organizationId), enabled: Boolean(organizationId) });
}

export function useInviteTeamMember(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { email: string; displayName: string; role: string }) => inviteTeamMember({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pendingInvitationsKey(organizationId) }),
  });
}

export function useResendInvitation(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { membershipId: string; invitedIdentityId: string }) => resendInvitationRequest({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pendingInvitationsKey(organizationId) }),
  });
}

export function useRevokeInvitation(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { membershipId: string }) => revokeInvitationRequest({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pendingInvitationsKey(organizationId) }),
  });
}

export function useSetMembershipStatus(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { targetIdentityId: string; status: MembershipStatusValue }) => setMembershipStatusRequest({ organizationId, ...params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membersKeyPrefix(organizationId) });
      queryClient.invalidateQueries({ queryKey: pendingInvitationsKey(organizationId) });
    },
  });
}
