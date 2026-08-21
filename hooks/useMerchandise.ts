import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMerchandiseProducts,
  createMerchandiseProduct,
  updateMerchandiseProduct,
  archiveMerchandiseProduct,
  fetchInventoryBalances,
  receiveInventory,
  adjustInventory,
  transferInventory,
  type CreateProductInput,
} from '@/lib/merchandiseClient';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Query/mutation hooks for the
 * Settings → Merchandise (catalog) and Settings → Inventory (stock) pages —
 * bundled the same way `hooks/useCalendarIntegrations.ts` bundles its own set.
 */
const productsKey = (organizationId: string, includeInactive: boolean) => ['merchandiseProducts', organizationId, includeInactive];
const balancesKey = (organizationId: string) => ['inventoryBalances', organizationId];

export function useMerchandiseProducts(organizationId: string, includeInactive = false) {
  return useQuery({
    queryKey: productsKey(organizationId, includeInactive),
    queryFn: () => fetchMerchandiseProducts(organizationId, includeInactive),
    enabled: Boolean(organizationId),
  });
}

export function useCreateMerchandiseProduct(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductInput) => createMerchandiseProduct(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['merchandiseProducts', organizationId] }),
  });
}

export function useUpdateMerchandiseProduct(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, patch }: { productId: string; patch: Partial<CreateProductInput> }) => updateMerchandiseProduct(organizationId, productId, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['merchandiseProducts', organizationId] }),
  });
}

export function useArchiveMerchandiseProduct(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) => archiveMerchandiseProduct(organizationId, productId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['merchandiseProducts', organizationId] }),
  });
}

export function useInventoryBalances(organizationId: string) {
  return useQuery({
    queryKey: balancesKey(organizationId),
    queryFn: () => fetchInventoryBalances(organizationId),
    enabled: Boolean(organizationId),
  });
}

export function useReceiveInventory(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof receiveInventory>[0]) => receiveInventory(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventoryBalances', organizationId] }),
  });
}

export function useAdjustInventory(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof adjustInventory>[0]) => adjustInventory(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventoryBalances', organizationId] }),
  });
}

export function useTransferInventory(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof transferInventory>[0]) => transferInventory(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventoryBalances', organizationId] }),
  });
}
