import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchActiveSessions, fetchActiveStaffCount, fetchActiveStaffList, revokeSessionById, signOutEverywhere } from '@/lib/identityAuthClient';

const SESSIONS_QUERY_KEY = ['identitySessions'];
const activeStaffCountKey = (organizationId: string) => ['activeStaffCount', organizationId];
const activeStaffListKey = (organizationId: string) => ['activeStaffList', organizationId];

export function useIdentitySessions() {
  return useQuery({ queryKey: SESSIONS_QUERY_KEY, queryFn: fetchActiveSessions });
}

/** Backs the sidebar's "N staff online" count. Polled every 60s — mirrors
    `useUnreadNotificationCount`'s exact interval and "always a live query,
    never a client-cached running total" posture. `enabled` mirrors
    `useOrganizationActivity`'s own pattern — the sidebar passes `false`
    outside identity mode, where the `sessions` registry this count reads
    is never populated. */
export function useActiveStaffCount(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: activeStaffCountKey(organizationId),
    queryFn: () => fetchActiveStaffCount(organizationId),
    enabled: Boolean(organizationId) && enabled,
    refetchInterval: 60_000,
  });
}

/** Backs the "N staff online" hover popover's list — unlike
    `useActiveStaffCount`, this is deliberately NOT always-enabled: `open`
    gates the query so the list is only ever fetched while the popover is
    actually open, never on every sidebar render. */
export function useActiveStaffList(organizationId: string, open: boolean) {
  return useQuery({
    queryKey: activeStaffListKey(organizationId),
    queryFn: () => fetchActiveStaffList(organizationId),
    enabled: Boolean(organizationId) && open,
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeSessionById,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
  });
}

export function useSignOutEverywhere() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOutEverywhere,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
  });
}
