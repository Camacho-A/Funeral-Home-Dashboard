import type { MerchandiseProduct } from '@/types/merchandiseProduct';
import type { InventoryBalance } from '@/types/inventoryBalance';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Client-side fetch wrappers
 * for the merchandise catalog + inventory routes — thin, typed, one per
 * route, mirroring `lib/calendarIntegrationsClient.ts`. All mutating calls
 * are same-origin (CSRF-protected server-side).
 */
async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.');
  }
  return body;
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export async function fetchMerchandiseProducts(organizationId: string, includeInactive = false): Promise<MerchandiseProduct[]> {
  const params = new URLSearchParams({ organizationId, ...(includeInactive ? { includeInactive: 'true' } : {}) });
  const body = await parseJsonOrThrow(await fetch(`/api/merchandise/products?${params.toString()}`));
  return (body.products as MerchandiseProduct[]) ?? [];
}

export type CreateProductInput = {
  organizationId: string;
  sku: string;
  name: string;
  description?: string | null;
  category: string;
  cost: number;
  retailPrice: number;
  taxable?: boolean;
  trackInventory?: boolean;
  reorderPoint?: number | null;
  defaultLocationId?: string | null;
  familyVisible?: boolean;
  supplierName?: string | null;
};

export async function createMerchandiseProduct(input: CreateProductInput): Promise<MerchandiseProduct> {
  const body = await parseJsonOrThrow(await fetch('/api/merchandise/products', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) }));
  return body.product as MerchandiseProduct;
}

export async function updateMerchandiseProduct(organizationId: string, productId: string, patch: Partial<CreateProductInput>): Promise<MerchandiseProduct> {
  const body = await parseJsonOrThrow(await fetch(`/api/merchandise/products/${encodeURIComponent(productId)}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ organizationId, ...patch }) }));
  return body.product as MerchandiseProduct;
}

export async function archiveMerchandiseProduct(organizationId: string, productId: string): Promise<MerchandiseProduct> {
  const params = new URLSearchParams({ organizationId });
  const body = await parseJsonOrThrow(await fetch(`/api/merchandise/products/${encodeURIComponent(productId)}?${params.toString()}`, { method: 'DELETE' }));
  return body.product as MerchandiseProduct;
}

export async function fetchInventoryBalances(organizationId: string): Promise<InventoryBalance[]> {
  const params = new URLSearchParams({ organizationId });
  const body = await parseJsonOrThrow(await fetch(`/api/inventory?${params.toString()}`));
  return (body.balances as InventoryBalance[]) ?? [];
}

export async function receiveInventory(input: { organizationId: string; productId: string; locationId: string; quantity: number; unitCost: number; supplierName?: string | null; receiptReference?: string }): Promise<InventoryBalance> {
  const body = await parseJsonOrThrow(await fetch('/api/inventory/receive', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) }));
  return body.balance as InventoryBalance;
}

export async function adjustInventory(input: { organizationId: string; productId: string; locationId: string; quantityDelta: number; movementType: 'adjustment' | 'damage' | 'shrinkage' | 'correction'; reason: string }): Promise<InventoryBalance> {
  const body = await parseJsonOrThrow(await fetch('/api/inventory/adjust', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) }));
  return body.balance as InventoryBalance;
}

export async function transferInventory(input: { organizationId: string; productId: string; fromLocationId: string; toLocationId: string; quantity: number }): Promise<{ from: InventoryBalance; to: InventoryBalance }> {
  const body = await parseJsonOrThrow(await fetch('/api/inventory/transfer', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) }));
  return body as { from: InventoryBalance; to: InventoryBalance };
}

// ---------------------------------------------------------------------------
// Phase 37 (Product Variants — ADR-041). Thin typed wrappers for the variant
// routes. No client-side inventory authority — the server always recomputes.
// ---------------------------------------------------------------------------
import type { MerchandiseProductVariant } from '@/types/merchandiseProductVariant';

export async function fetchVariants(organizationId: string, productId: string, includeInactive = false): Promise<MerchandiseProductVariant[]> {
  const params = new URLSearchParams({ organizationId, ...(includeInactive ? { includeInactive: 'true' } : {}) });
  const body = await parseJsonOrThrow(await fetch(`/api/merchandise/products/${encodeURIComponent(productId)}/variants?${params.toString()}`));
  return (body.variants as MerchandiseProductVariant[]) ?? [];
}

export type CreateVariantInput = {
  organizationId: string;
  sku: string;
  name: string;
  optionValues?: Record<string, string> | null;
  retailPriceOverride?: number | null;
  costOverride?: number | null;
  supplierIdOverride?: string | null;
};

export async function createVariant(productId: string, input: CreateVariantInput): Promise<MerchandiseProductVariant> {
  const body = await parseJsonOrThrow(await fetch(`/api/merchandise/products/${encodeURIComponent(productId)}/variants`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) }));
  return body.variant as MerchandiseProductVariant;
}

export async function updateVariant(organizationId: string, productId: string, variantId: string, patch: Partial<Omit<CreateVariantInput, 'organizationId'>>): Promise<MerchandiseProductVariant> {
  const body = await parseJsonOrThrow(await fetch(`/api/merchandise/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ organizationId, ...patch }) }));
  return body.variant as MerchandiseProductVariant;
}

export async function archiveVariant(organizationId: string, productId: string, variantId: string): Promise<MerchandiseProductVariant> {
  const params = new URLSearchParams({ organizationId });
  const body = await parseJsonOrThrow(await fetch(`/api/merchandise/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}?${params.toString()}`, { method: 'DELETE' }));
  return body.variant as MerchandiseProductVariant;
}

