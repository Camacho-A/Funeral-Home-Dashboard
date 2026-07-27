import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchActiveSessions, revokeSessionById, signOutEverywhere } from '@/lib/identityAuthClient';

const SESSIONS_QUERY_KEY = ['identitySessions'];

export function useIdentitySessions() {
  return useQuery({ queryKey: SESSIONS_QUERY_KEY, queryFn: fetchActiveSessions });
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
