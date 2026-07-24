import { useQuery } from '@tanstack/react-query';
import { pricingClient } from '@/services/pricingClient';
import { useOrganization } from './useOrganization';

/** Phase 19C (Service Catalog, Case Order & Pricing Engine). Same
    organizationId-leading query-key convention as every other
    organization-scoped hook. */
export function useServiceCatalog() {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['serviceCatalog', organization.organizationId],
    queryFn: () => pricingClient.getServiceCatalog(organization),
  });
}
