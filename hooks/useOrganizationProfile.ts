import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchOrganizationProfile,
  updateOrganizationProfile,
  updatePrimaryLocationProfile,
  type OrganizationProfileFields,
  type PrimaryLocationFields,
} from '@/lib/organizationProfileClient';

/** Settings → Organization Profile (2026-09). Same query/mutation-hook
    shape as `hooks/useCaseNumbering.ts`. Both mutations invalidate the
    same read query so a successful save always refreshes the displayed
    profile from the server's own response, never from an optimistic
    client-side guess. */
const organizationProfileKey = (organizationId: string) => ['organizationProfile', organizationId];

export function useOrganizationProfile(organizationId: string) {
  return useQuery({
    queryKey: organizationProfileKey(organizationId),
    queryFn: () => fetchOrganizationProfile(organizationId),
    enabled: Boolean(organizationId),
  });
}

export function useUpdateOrganizationProfile(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (organization: Partial<OrganizationProfileFields>) => updateOrganizationProfile(organizationId, organization),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: organizationProfileKey(organizationId) }),
  });
}

export function useUpdatePrimaryLocationProfile(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (location: Partial<PrimaryLocationFields>) => updatePrimaryLocationProfile(organizationId, location),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: organizationProfileKey(organizationId) }),
  });
}
