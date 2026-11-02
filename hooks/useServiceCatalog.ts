import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pricingClient, type CatalogItemChanges, type NewCatalogItemInput } from '@/services/pricingClient';
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

/** Gus Phase 5C-3. The active display categories (for grouping catalog
    items on a case order). */
export function useCatalogCategories() {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['serviceCatalog', organization.organizationId, 'categories'],
    queryFn: () => pricingClient.getCatalogCategories(organization),
  });
}

/** Gus Phase 5C-3. Settings › Price Catalog: every item and category,
    inactive ones included. */
export function usePriceCatalog() {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['serviceCatalog', organization.organizationId, 'all'],
    queryFn: () => pricingClient.getPriceCatalog(organization),
  });
}

/** Every Price Catalog write invalidates every catalog query (the
    ['serviceCatalog', organizationId] prefix), so open order selectors pick
    up the change; existing case orders keep the prices they were saved with. */
function useCatalogMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const organization = useOrganization();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['serviceCatalog', organization.organizationId] });
    },
  });
}

export function useCreateCatalogItem() {
  const organization = useOrganization();
  return useCatalogMutation((input: NewCatalogItemInput) => pricingClient.createCatalogItem(organization, input));
}

export function useUpdateCatalogItem() {
  const organization = useOrganization();
  return useCatalogMutation((input: { itemId: string; changes: CatalogItemChanges; expectedRevision: number; confirmPrimaryServiceDeactivation?: boolean }) =>
    pricingClient.updateCatalogItem(organization, input.itemId, input.changes, input.expectedRevision, {
      confirmPrimaryServiceDeactivation: input.confirmPrimaryServiceDeactivation,
    }),
  );
}

export function useCreateCatalogCategory() {
  const organization = useOrganization();
  return useCatalogMutation((name: string) => pricingClient.createCatalogCategory(organization, name));
}

export function useUpdateCatalogCategory() {
  const organization = useOrganization();
  return useCatalogMutation((input: { categoryId: string; changes: Partial<{ name: string; sortOrder: number; isActive: boolean }>; expectedRevision: number }) =>
    pricingClient.updateCatalogCategory(organization, input.categoryId, input.changes, input.expectedRevision),
  );
}
