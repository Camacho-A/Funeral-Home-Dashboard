import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchPortalInvitations,
  issuePortalInvitation,
  revokePortalInvitationRequest,
  fetchPortalAccess,
  setPortalAccessAction,
  fetchPortalMessages,
  sendPortalStaffMessage,
} from '@/lib/portalClient';
import type { PortalRelationshipType } from '@/domain/portal/portalRelationshipRegistry';

/**
 * Phase 29 (Family Portal & External Collaboration). Query/mutation hooks
 * for the Case Detail page's "Family Portal" tab — bundled in one file the
 * same way `hooks/useRbac.ts` bundles all of `/api/rbac/*`'s hooks,
 * since every mutation here invalidates one of these three per-case
 * cache entries.
 */
const invitationsKey = (organizationId: string, caseId: string) => ['casePortalInvitations', organizationId, caseId];
const accessKey = (organizationId: string, caseId: string) => ['casePortalAccess', organizationId, caseId];
const messagesKey = (organizationId: string, caseId: string) => ['casePortalMessages', organizationId, caseId];

export function usePortalInvitations(organizationId: string, caseId: string) {
  return useQuery({
    queryKey: invitationsKey(organizationId, caseId),
    queryFn: () => fetchPortalInvitations(organizationId, caseId),
    enabled: Boolean(organizationId && caseId),
  });
}

export function useIssuePortalInvitation(organizationId: string, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { email: string; displayName: string; relationshipType: PortalRelationshipType }) =>
      issuePortalInvitation({ organizationId, caseId, ...params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invitationsKey(organizationId, caseId) });
      queryClient.invalidateQueries({ queryKey: accessKey(organizationId, caseId) });
    },
  });
}

export function useRevokePortalInvitation(organizationId: string, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) => revokePortalInvitationRequest({ organizationId, caseId, invitationId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invitationsKey(organizationId, caseId) });
      queryClient.invalidateQueries({ queryKey: accessKey(organizationId, caseId) });
    },
  });
}

export function usePortalAccess(organizationId: string, caseId: string) {
  return useQuery({
    queryKey: accessKey(organizationId, caseId),
    queryFn: () => fetchPortalAccess(organizationId, caseId),
    enabled: Boolean(organizationId && caseId),
  });
}

export function useSetPortalAccessAction(organizationId: string, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { accessId: string; action: 'disable' | 'revoke' }) => setPortalAccessAction({ organizationId, caseId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accessKey(organizationId, caseId) }),
  });
}

export function usePortalMessages(organizationId: string, caseId: string) {
  return useQuery({
    queryKey: messagesKey(organizationId, caseId),
    queryFn: () => fetchPortalMessages(organizationId, caseId),
    enabled: Boolean(organizationId && caseId),
  });
}

export function useSendPortalStaffMessage(organizationId: string, caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => sendPortalStaffMessage({ organizationId, caseId, body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messagesKey(organizationId, caseId) }),
  });
}
