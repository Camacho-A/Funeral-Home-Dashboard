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
 * Variants (size/color/finish/material) are DEFERRED this phase: each
 * sellable configuration is its own product row with its own SKU, price, and
 * independent per-location stock. `parentProductId` is a reserved extension
 * point (always null today) so a future phase can group SKUs under a parent
 * without a migration.
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
      Beacon route. Null ⇒ no image. */
  imageStorageKey: string | null;
  /** Whether this product may appear in the family portal's order summary
      (name/price/image only — never cost). Defaults false. */
  familyVisible: boolean;
  /** Free-text supplier name for provenance — no structured Supplier
      directory this phase (deferred). Null ⇒ unspecified. */
  supplierName: string | null;
  /** RESERVED for future structured variants — always null this phase. */
  parentProductId: string | null;
  createdAt: string;
  updatedAt: string;
};
