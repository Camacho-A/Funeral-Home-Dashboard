import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

/** 2026-10 (Gus Camacho Jr. service catalog). Settings › Services &
    Pricing price edit. Invalidates the catalog query, so every open
    "Services & Charges" selector picks up the new price; existing case
    orders keep the unit prices they were saved with. */
export function useUpdateServiceCatalogPrice() {
  const organization = useOrganization();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { itemId: string; defaultPrice: number | null }) =>
      pricingClient.updateServiceCatalogPrice(organization, input.itemId, input.defaultPrice),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serviceCatalog', organization.organizationId] });
    },
  });
}
