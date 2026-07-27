import { useMutation, useQuery } from '@tanstack/react-query';
import { fetchMyMemberships, switchOrganization } from '@/lib/identityAuthClient';

export function useMyMemberships() {
  return useQuery({ queryKey: ['myMemberships'], queryFn: fetchMyMemberships });
}

export function useSwitchOrganization() {
  return useMutation({ mutationFn: switchOrganization });
}
