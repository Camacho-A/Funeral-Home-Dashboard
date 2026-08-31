import { describe, it, expect } from 'vitest';
import { resolveVariantEconomics } from './variantEconomics';
import type { MerchandiseProduct } from '../../types/merchandiseProduct';
import type { MerchandiseProductVariant } from '../../types/merchandiseProductVariant';

const product: MerchandiseProduct = {
  id: 'p1', organizationId: 'org', sku: 'URN', name: 'Urn', description: null, category: 'urn',
  cost: 10_000, retailPrice: 25_000, taxable: true, isActive: true, trackInventory: true,
  reorderPoint: null, defaultLocationId: null, imageStorageKey: null, familyVisible: false,
  supplierName: null, supplierId: 'sup-parent', parentProductId: null, hasVariants: true,
  createdAt: 't', updatedAt: 't',
};

function variant(overrides: Partial<MerchandiseProductVariant>): MerchandiseProductVariant {
  return {
    id: 'v1', organizationId: 'org', productId: 'p1', sku: 'URN-BRONZE', name: 'Bronze',
    optionValues: null, retailPriceOverride: null, costOverride: null, taxableOverride: null,
    supplierIdOverride: null, isActive: true, createdAt: 't', updatedAt: 't', ...overrides,
  };
}

describe('Phase 37 resolveVariantEconomics — B2 nullable overrides → parent', () => {
  it('non-variant product (variant null) returns the product values', () => {
    expect(resolveVariantEconomics(product, null)).toEqual({
      retailPrice: 25_000, cost: 10_000, taxable: true, supplierId: 'sup-parent',
    });
  });

  it('all-null overrides inherit every parent value', () => {
    expect(resolveVariantEconomics(product, variant({}))).toEqual({
      retailPrice: 25_000, cost: 10_000, taxable: true, supplierId: 'sup-parent',
    });
  });

  it('each override wins independently over the parent', () => {
    const v = variant({ retailPriceOverride: 30_000, costOverride: 12_000, taxableOverride: false, supplierIdOverride: 'sup-bronze' });
    expect(resolveVariantEconomics(product, v)).toEqual({
      retailPrice: 30_000, cost: 12_000, taxable: false, supplierId: 'sup-bronze',
    });
  });

  it('a false taxableOverride is honored (not treated as "unset")', () => {
    expect(resolveVariantEconomics(product, variant({ taxableOverride: false })).taxable).toBe(false);
  });

  it('a zero price/cost override is honored (not treated as "unset")', () => {
    const v = variant({ retailPriceOverride: 0, costOverride: 0 });
    const r = resolveVariantEconomics(product, v);
    expect(r.retailPrice).toBe(0);
    expect(r.cost).toBe(0);
  });
});
