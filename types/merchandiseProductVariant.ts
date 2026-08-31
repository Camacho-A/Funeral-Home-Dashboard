/**
 * Phase 37 (Product Variants, Sales Tax & Merchandise Pricing — ADR-041). An
 * optional sellable variation of a `MerchandiseProduct` — e.g. a Bronze /
 * Companion urn, or an Oak / Blue-interior casket. A variant is a FIRST-CLASS
 * row in the dedicated `merchandiseProductVariants` collection, NOT another
 * `MerchandiseProduct` row (decision R1/D1).
 *
 * Bifurcation (strict, decision R6): a variant exists only under a product with
 * `hasVariants: true` (a *variant parent*). The parent is never itself
 * stocked/sold/reserved/received; every operational action against a
 * variant-parent product identifies an active `variantId`. A product with
 * `hasVariants: false` has no variants and keeps the original Phase 35
 * product-level behavior (no variantId anywhere).
 *
 * Pricing/economics inheritance (B2, decision R2/R5): the override fields are
 * NULLABLE and resolve to the parent product's value at read time — never
 * copied onto the variant at creation. See
 * `domain/merchandise/variantEconomics.ts#resolveVariantEconomics`:
 *   effective X = variant.XOverride ?? parent.X
 * for retailPrice, cost, taxable, and supplierId. Historical CaseOrder / PO /
 * receipt snapshots are authoritative for history and never re-derive from a
 * later override change.
 *
 * Like `MerchandiseProduct`, a variant archives via `isActive: false` and is
 * never hard-deleted, so historical order/inventory/procurement references
 * remain resolvable. `cost`/`supplierId` overrides are INTERNAL and never
 * appear in any family-facing DTO.
 */
export type MerchandiseProductVariant = {
  id: string;
  organizationId: string;
  /** → merchandiseProducts.beaconMerchandiseProductId (the variant parent). */
  productId: string;
  /** Stable machine identifier, unique per organization across BOTH
      merchandiseProducts.sku AND every other variant sku (application-enforced;
      Wix's single-field unique index cannot span two collections — the residual
      TOCTOU race is documented, same class as the Phase 35 product-SKU check). */
  sku: string;
  /** Human label for this variation, e.g. "Bronze / Companion". Snapshotted
      onto the CaseOrder line for history. */
  name: string;
  /** JSON-encoded ordered option map, e.g. {"Material":"Bronze","Size":
      "Companion"}. A simple structured representation — NOT an arbitrary
      option-definition engine. Null ⇒ unspecified. */
  optionValues: string | null;
  /** Integer cents. Null ⇒ inherit parent `retailPrice` at read time. */
  retailPriceOverride: number | null;
  /** Integer cents — INTERNAL. Null ⇒ inherit parent `cost`. */
  costOverride: number | null;
  /** Null ⇒ inherit parent `taxable`. */
  taxableOverride: boolean | null;
  /** → suppliers.beaconSupplierId. Null ⇒ inherit parent `supplierId`.
      Justified: variants of one product may be sourced from different suppliers
      and Phase 36 procurement/AP must identify the correct operational supplier.
      Must belong to the same organization and be active when newly assigned;
      historical PO/receipt/AP snapshots are unchanged if this later changes. */
  supplierIdOverride: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
