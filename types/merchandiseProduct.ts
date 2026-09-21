import type { MerchandiseCategoryKey } from '../domain/merchandise/merchandiseCategoryRegistry';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). One sellable funeral-home
 * product — urns, caskets, keepsakes, memorial jewelry, flowers, vaults,
 * cremation containers, clothing, stationery, register books, miscellaneous.
 * See docs/adr/ADR-039-merchandise-inventory-and-commerce.md.
 *
 * Distinct from `ServiceCatalogItem` (Phase 19C): a service is a billable
 * line with no physical stock; a merchandise product is a physical good with
 * per-location inventory (see types/inventoryMovement.ts). Both flow into the
 * same authoritative `CaseOrder` as line items — merchandise as
 * `CaseOrderLineItem.lineKind: 'merchandise'` — never a competing order.
 *
 * Variants (size/color/finish/material) are Phase 37 (ADR-041): an optional
 * sellable variation is a first-class `MerchandiseProductVariant` row keyed to
 * this product (see types/merchandiseProductVariant.ts), NOT another product
 * row. `hasVariants` is the server-maintained mode flag — when true this
 * product is a *variant parent*: it is never itself stocked/sold/reserved/
 * received; every operational action identifies a `variantId`. When false the
 * product follows the original Phase 35 product-level behavior unchanged.
 * `parentProductId` is a legacy reserved field, unused by the Phase 37 variant
 * model (which uses the dedicated collection) — always null.
 *
 * `cost` is INTERNAL wholesale/acquisition cost and margin-bearing — it is
 * never included in any family-facing DTO or `/api/family/*` response (a
 * structural test enforces this). Products archive via `isActive: false`;
 * they are never hard-deleted, so historical CaseOrder line items and
 * inventory movements referencing a product always remain resolvable.
 */
export type MerchandiseProduct = {
  id: string;
  organizationId: string;
  /** Stable machine identifier, unique per organization (application-enforced
      — Wix Data's single-field unique index is not organization-scoped). */
  sku: string;
  name: string;
  description: string | null;
  category: MerchandiseCategoryKey;
  /** Integer cents — INTERNAL acquisition cost, never exposed to family. The
      basis for COGS at fulfillment (Dr COGS / Cr Inventory Asset). */
  cost: number;
  /** Integer cents — the price snapshotted onto a CaseOrder line item at
      order-version time. */
  retailPrice: number;
  /** Whether sales tax would apply — captured now; tax CALCULATION is
      deferred this phase (no rate config exists), so this drives nothing yet. */
  taxable: boolean;
  isActive: boolean;
  /** false ⇒ a non-stocked product (e.g. drop-shipped flowers): sellable
      without inventory availability enforcement, and it produces no
      reservation/COGS/inventory movement. */
  trackInventory: boolean;
  /** Low-stock threshold (on-hand ≤ reorderPoint fires a single low-stock
      notification on the crossing). Null ⇒ never flagged low. */
  reorderPoint: number | null;
  /** → organizationLocations.beaconOrganizationLocationId; seeds the
      case-selection UI's default location. Null ⇒ no default. */
  defaultLocationId: string | null;
  /** A DocumentStorageProvider storage key (Phase 25) — never a URL. Bytes
      live in blob storage; downloads are proxied through an auth-checked
      Solis route. Null ⇒ no image. */
  imageStorageKey: string | null;
  /** Whether this product may appear in the family portal's order summary
      (name/price/image only — never cost). Defaults false. */
  familyVisible: boolean;
  /** Free-text supplier name — the Phase 35 provenance field. From Phase 36
      it is a historical snapshot / display fallback only; the authoritative
      supplier relationship is `supplierId`. Null ⇒ unspecified. */
  supplierName: string | null;
  /** Phase 36: the authoritative link to a structured `Supplier`. Additive
      and nullable — pre-Phase-36 rows and never-linked products keep null
      and fall back to `supplierName` for display. → suppliers.beaconSupplierId. */
  supplierId: string | null;
  /** LEGACY reserved field — the Phase 37 variant model uses the dedicated
      `merchandiseProductVariants` collection, not this field. Always null. */
  parentProductId: string | null;
  /** Phase 37 (ADR-041): server-maintained mode flag. true ⇒ this product is a
      variant parent — not itself stocked/sold/reserved/received; every
      operational action must identify an active `variantId`. false ⇒ original
      Phase 35 product-level behavior (no variantId anywhere). Additive; every
      pre-Phase-37 product defaults false. The browser can never toggle this
      independently of variant lifecycle — `merchandiseVariantService` is its
      sole authority and keeps it consistent with actual active-variant state
      (a reconciliation/structural test detects drift). */
  hasVariants: boolean;
  createdAt: string;
  updatedAt: string;
};
