import type { MerchandiseProduct } from '../../types/merchandiseProduct';
import type { MerchandiseProductVariant } from '../../types/merchandiseProductVariant';

/**
 * Phase 37 (Product Variants, Sales Tax & Merchandise Pricing — ADR-041). The
 * pure B2 inheritance resolver: a variant's nullable overrides resolve to the
 * parent product's value at READ time (decision R2/R5) —
 *   effective X = variant.XOverride ?? parent.X
 * for retailPrice, cost, taxable, and supplierId. Nothing is copied onto a
 * variant at creation, so editing the parent flows through to every
 * non-overriding variant automatically.
 *
 * This is the *live catalog* view only. Historical CaseOrder / PO / receipt
 * snapshots are authoritative for history and must never be re-derived through
 * this resolver — they captured their effective values when the order/PO/receipt
 * was created.
 *
 * Pure and side-effect-free (no I/O), shareable by browser preview and server
 * exactly like the rest of domain/pricing.
 */
export type ResolvedEconomics = {
  retailPrice: number;
  cost: number;
  taxable: boolean;
  supplierId: string | null;
};

/**
 * Resolve the effective economics of a sellable unit. Pass `variant = null` for
 * a non-variant product (Mode A) — its own values are returned unchanged. Pass
 * the variant for a variant-parent product (Mode B) — each field falls back to
 * the parent only when the variant's override is null.
 */
export function resolveVariantEconomics(
  product: MerchandiseProduct,
  variant: MerchandiseProductVariant | null,
): ResolvedEconomics {
  if (!variant) {
    return {
      retailPrice: product.retailPrice,
      cost: product.cost,
      taxable: product.taxable,
      supplierId: product.supplierId,
    };
  }
  return {
    retailPrice: variant.retailPriceOverride ?? product.retailPrice,
    cost: variant.costOverride ?? product.cost,
    taxable: variant.taxableOverride ?? product.taxable,
    supplierId: variant.supplierIdOverride ?? product.supplierId,
  };
}
