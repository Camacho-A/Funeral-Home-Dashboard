/**
 * Price catalog (2026-11). One change to one price. Never deleted, and its
 * values are never edited; only its `status` moves, once, from `pending` to
 * `applied` or `not_applied` (services/catalogPriceChangeJournal.ts). The previous value is kept on every row, so an item's
 * full price history (and who changed it, when, and why) can always be
 * read back. A price change never reprices an existing case order: order
 * lines keep the price they were agreed at (domain/pricing/pricingPermissions.ts
 * — orderLinePriceLock); only an explicit, authorized reprice moves them.
 */
export type CatalogPriceItemType = 'service' | 'merchandise_product' | 'merchandise_variant';

/** `pending` — recorded, the price write not yet known to have happened.
    `applied` — the item's price was set by this change.
    `not_applied` — the price was not changed by this request. */
export type CatalogPriceChangeStatus = 'pending' | 'applied' | 'not_applied';

/** How a change was settled: by its own request (`applied`, `conflict` —
    someone else changed the price first, `write_failed`), or later by
    reconciliation from the item's priceChangeId marker. */
export type CatalogPriceChangeOutcome = 'applied' | 'conflict' | 'write_failed' | 'reconciled_applied' | 'reconciled_not_applied';

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
  status: CatalogPriceChangeStatus;
  /** Null while pending. */
  outcome: CatalogPriceChangeOutcome | null;
  settledAt: string | null;
  /** The client's idempotency key, when it sent one: a repeated request
      with the same key maps to this same row and never changes the price
      twice. */
  requestKey: string | null;
};
