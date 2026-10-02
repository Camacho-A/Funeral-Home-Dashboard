import { useQuery } from '@tanstack/react-query';
import { organizationsService } from '@/services/organizationsService';
import { useOrganization } from './useOrganization';

/**
 * Manors cleanup phase (Task #4, bottom-of-sidebar organization logo).
 * Mirrors `useOrganizationRecord()` exactly — `data` is `null` for an
 * organization with no branding configured yet (every pre-existing
 * organization today), not an error state; callers render nothing rather
 * than a placeholder in that case.
 */
export function useOrganizationBranding() {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['organizationBranding', organization.organizationId],
    queryFn: () => organizationsService.getBranding(organization),
  });
}
