/**
 * Price catalog (2026-11). One change to one price — append-only, never
 * edited or deleted. The previous value is kept on every row, so an item's
 * full price history (and who changed it, when, and why) can always be
 * read back. A price change never reprices an existing case order: order
 * lines keep the price they were agreed at (domain/pricing/pricingPermissions.ts
 * — orderLinePriceLock); only an explicit, authorized reprice moves them.
 */
export type CatalogPriceItemType = 'service' | 'merchandise_product' | 'merchandise_variant';

export type CatalogPriceChange = {
  id: string;
  organizationId: string;
  itemType: CatalogPriceItemType;
  /** ServiceCatalogItem.id, MerchandiseProduct.id or MerchandiseProductVariant.id. */
  itemId: string;
  /** serviceCode or SKU at the time of the change. */
  itemCode: string;
  /** The item's name at the time of the change. */
  itemName: string;
  /** Integer cents; null = "price not set" (or, for a variant, "inherits the product's price"). */
  previousPrice: number | null;
  newPrice: number | null;
  /** Identity id of who changed it, or null for a system change (onboarding seed). */
  changedBy: string | null;
  changedAt: string;
  reason: string | null;
  /** Ties the row to the request and its activity event. */
  correlationId: string;
};
