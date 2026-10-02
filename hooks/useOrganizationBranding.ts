import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { organizationsService } from '@/services/organizationsService';
import { useOrganization } from './useOrganization';

/**
 * Manors cleanup phase (Task #4, bottom-of-sidebar organization logo).
 * Mirrors `useOrganizationRecord()` exactly — `data` is `null` for an
 * organization with no branding configured yet (every pre-existing
 * organization today), not an error state; callers render nothing rather
 * than a placeholder in that case.
 *
 * Organization Branding Settings phase: `brandingKey` is now exported so
 * the upload/remove mutations below invalidate the exact same cache
 * entry this query reads — same "one shared key, no second cache"
 * discipline `hooks/useOrganizationProfile.ts`'s own `organizationProfileKey`
 * already established. Sidebar.tsx reads this same hook, so a successful
 * save refreshes it immediately, with no logout/reload/new session.
 */
const brandingKey = (organizationId: string) => ['organizationBranding', organizationId];

export function useOrganizationBranding() {
  const organization = useOrganization();
  return useQuery({
    queryKey: brandingKey(organization.organizationId),
    queryFn: () => organizationsService.getBranding(organization),
  });
}

export function useUploadBrandingLogo() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => organizationsService.uploadBrandingLogo(organizationId, file),
    onSuccess: (branding) => queryClient.setQueryData(brandingKey(organizationId), branding),
  });
}

export function useRemoveBrandingLogo() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => organizationsService.removeBrandingLogo(organizationId),
    onSuccess: (branding) => queryClient.setQueryData(brandingKey(organizationId), branding),
  });
}
