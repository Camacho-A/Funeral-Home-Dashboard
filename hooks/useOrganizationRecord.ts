import { useQuery } from '@tanstack/react-query';
import { organizationsService } from '@/services/organizationsService';
import { useOrganization } from './useOrganization';

/**
 * Phase 15A (Wix Organization Read Integration). Fetches the full
 * Organization record (name, isActive) for display — distinct from
 * useOrganization(), which only ever supplies the trusted, authorization-
 * resolved organizationId and must not be conflated with this hook.
 * Mirrors the existing useStaff()/useCases() shape exactly.
 */
export function useOrganizationRecord() {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['organization', organization.organizationId],
    queryFn: () => organizationsService.get(organization),
  });
}
