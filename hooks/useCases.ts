import { useQuery } from '@tanstack/react-query';
import { casesService, type CaseFilters } from '@/services/casesService';
import { useOrganization } from './useOrganization';

export function useCases(filters: CaseFilters = {}) {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['cases', organization.organizationId, filters],
    queryFn: () => casesService.list(organization, filters, organization.dataAdapterMode),
  });
}
