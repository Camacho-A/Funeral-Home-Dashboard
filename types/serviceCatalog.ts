/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). The catalog of
 * billable services one organization offers, each with its own server-only
 * price — never hardcoded in a React component or in domain/pricing's
 * calculation logic (see domain/pricing/calculateOrder.ts). Today's
 * implementation seeds exactly one organization's catalog (Manor's
 * Cremation — see services/__mocks__/pricingFixtures.ts), but the shape
 * itself carries no assumption that only one organization, one price list,
 * or these five specific services will ever exist.
 *
 * `category` and `pricingType` are plain strings, not closed unions —
 * genuinely new categories/pricing rules (a future percentage-based fee, a
 * tiered rate, a seasonal surcharge) must be addable by inserting new
 * catalog rows, never by widening a type here and shipping a code change.
 * The three category values and two pricing types below are simply the
 * ones domain/pricing/calculateOrder.ts currently knows how to interpret —
 * an unrecognized category/pricingType is invisible to that calculation
 * (never charged, never crashes), not a validation error at this layer.
 */
export type ServiceCatalogItem = {
  id: string;
  organizationId: string;
  /** Stable machine identifier — e.g. 'DIRECT_CREMATION'. What the pricing
      engine and line items key off of; `displayName` is what a human sees. */
  serviceCode: string;
  displayName: string;
  /** 'base' (always included, e.g. Direct Cremation), 'weight_surcharge'
      (mutually-exclusive tier, selected via a radio group), 'addon'
      (independent opt-in, checkbox +/- quantity), or 'service_type'
      (2026-10, Gus Camacho Jr.: the one primary service a case order is
      for — exactly one chosen per order via a radio group, see
      ServiceSelections.serviceTypeCode). See domain/pricing. */
  category: string;
  /** 'flat' — unitPrice applies once regardless of any quantity control
      (Direct Cremation, a weight surcharge, Mail Cremated Remains). 'per_unit'
      — unitPrice multiplies by a staff-chosen quantity (Extra Death
      Certificates). */
  pricingType: string;
  /** Integer cents — matches PaymentRecord.amount's existing convention.
      2026-10: `null` means "price not set yet" — a catalog row whose
      price the funeral home hasn't supplied (Gus Camacho Jr.'s catalog is
      onboarded entirely unpriced; an administrator enters prices later in
      Settings › Price Catalog). Null is NEVER $0: the pricing engine
      reports it as unpriced (domain/pricing/calculateOrder.ts's
      `unpricedItems`), the server refuses to persist an order that
      selects it, and every display labels it "Price not set". */
  defaultPrice: number | null;
  /** Phase 39 (Family Billing & FTC Compliance). Optional additive override
      of the FTC line classification for this item (see
      domain/billing/ftcClassification.ts). Null/absent = derive from
      `category` via the classification registry. An explicit, valid value
      wins; an invalid/unknown value is treated as absent (never fabricates a
      compliance meaning). Drives only compliance-document rendering — never
      pricing, the GL, or AR. */
  ftcClass?: string | null;
  isActive: boolean;
  /** Gus Phase 5C-3. Optional longer, internal description shown in
      Settings › Price Catalog — never on an order line (a line snapshots
      `displayName`). Absent on rows written before 5C-3. */
  description?: string | null;
  /** Gus Phase 5C-3. The organization-configured display category this item
      is filed under (ServiceCatalogCategory.id), or null/absent for none.
      Purely organizational — it never changes how an item is priced
      (`category` above does that). */
  categoryId?: string | null;
  /** Gus Phase 5C-3 (finalization). An administrator-added Merchandise item
      can be linked to one existing inventory-tracked merchandise product
      (MerchandiseProduct.id) — the inventory system stays the source of
      truth for stock and for the item's price. Null/absent = not linked. */
  merchandiseProductId?: string | null;
  /** Gus Phase 5C-3. Optimistic-concurrency counter, bumped by every catalog
      edit; absent on rows written before 5C-3, which counts as 0. */
  revision?: number;
  /** Display/calculation ordering — matches the "Live Itemized Summary"
      example order (base, then weight surcharge, then add-ons). */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Gus Phase 5C-3 (administrator-managed price catalog). One display category
 * an organization files its catalog items under — "Funeral Services",
 * "Merchandise", "Documents and Permits" … — created, renamed, reordered and
 * deactivated by an administrator in Settings › Price Catalog. Never a
 * pricing rule: categories only organize and filter the catalog.
 */
export type ServiceCatalogCategory = {
  id: string;
  organizationId: string;
  name: string;
  sortOrder: number;
  /** A deactivated category keeps its items (and every order line already
      priced from them); it is only no longer offered for new items. */
  isActive: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

/** Gus Phase 5C-3. One catalog item staff add to a case order — the item's
    code and how many. A calculation input only: the server prices it from
    its own catalog, never from anything the browser sends. */
export type CatalogItemSelection = {
  serviceCode: string;
  quantity: number;
};
