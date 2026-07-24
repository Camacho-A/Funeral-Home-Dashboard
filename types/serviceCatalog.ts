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
      (mutually-exclusive tier, selected via a radio group), or 'addon'
      (independent opt-in, checkbox +/- quantity). See domain/pricing. */
  category: string;
  /** 'flat' — unitPrice applies once regardless of any quantity control
      (Direct Cremation, a weight surcharge, Mail Cremated Remains). 'per_unit'
      — unitPrice multiplies by a staff-chosen quantity (Extra Death
      Certificates). */
  pricingType: string;
  /** Integer cents — matches PaymentRecord.amount's existing convention. */
  defaultPrice: number;
  isActive: boolean;
  /** Display/calculation ordering — matches the "Live Itemized Summary"
      example order (base, then weight surcharge, then add-ons). */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
