import { SERVICE_TYPE_CATEGORY } from '../pricing/serviceCodes';
import type { StarterServiceCatalogEntry } from './starterServiceCatalog';

/**
 * 2026-10 (Gus Camacho Jr. service catalog). Gus Camacho Jr. Funeral Home's
 * service catalog exactly as the funeral home supplied it — six primary
 * services, in this display order, one of which is chosen per case order
 * (category 'service_type', see domain/pricing/serviceCodes.ts's
 * SERVICE_TYPE_CATEGORY). Nothing here is invented:
 *
 * - every `defaultPrice` is null ("price not set") — the funeral home hasn't
 *   supplied prices yet; an administrator enters them later in Settings ›
 *   Services & Pricing. Until then a case order selecting one is refused
 *   server-side rather than saved at a made-up amount;
 * - there are no add-ons and no surcharges — none were supplied.
 *
 * `serviceCode`s are stable machine identifiers (line items and audit
 * history key off them), so a display-name correction never needs a code
 * change. DIRECT_CREMATION deliberately shares Manor's Cremation's code
 * string — the pricing engine distinguishes the two by category (Manors'
 * row is its always-included 'base'; this one is a chosen service type).
 *
 * Plain data only, same shape as STARTER_SERVICE_CATALOG: materialized into
 * fresh, Gus-owned `serviceCatalog` rows by
 * services/organizationProvisioningService.ts's `seedServiceCatalog`
 * (via resolveStarterServiceCatalog) and by the local mock fixtures
 * (services/__mocks__/pricingFixtures.ts).
 */
export const GUS_SERVICE_CODES = {
  DIRECT_CREMATION: 'DIRECT_CREMATION',
  CREMATION_WITH_FINAL_GOODBYE: 'CREMATION_WITH_FINAL_GOODBYE',
  CREMATION_WITH_VIEWING: 'CREMATION_WITH_VIEWING',
  GRAVESIDE_BURIAL_SERVICE_ONLY: 'GRAVESIDE_BURIAL_SERVICE_ONLY',
  VETERANS_GRAVESIDE_BURIAL_SERVICE_ONLY: 'VETERANS_GRAVESIDE_BURIAL_SERVICE_ONLY',
  DIRECT_ENTOMBMENT: 'DIRECT_ENTOMBMENT',
} as const;

export const GUS_SERVICE_CATALOG: readonly StarterServiceCatalogEntry[] = Object.freeze([
  { serviceCode: GUS_SERVICE_CODES.DIRECT_CREMATION, displayName: 'Direct Cremation', category: SERVICE_TYPE_CATEGORY, pricingType: 'flat', defaultPrice: null, sortOrder: 1 },
  { serviceCode: GUS_SERVICE_CODES.CREMATION_WITH_FINAL_GOODBYE, displayName: 'Cremation with Final Goodbye', category: SERVICE_TYPE_CATEGORY, pricingType: 'flat', defaultPrice: null, sortOrder: 2 },
  { serviceCode: GUS_SERVICE_CODES.CREMATION_WITH_VIEWING, displayName: 'Cremation with Viewing', category: SERVICE_TYPE_CATEGORY, pricingType: 'flat', defaultPrice: null, sortOrder: 3 },
  { serviceCode: GUS_SERVICE_CODES.GRAVESIDE_BURIAL_SERVICE_ONLY, displayName: 'Graveside Burial Service Only (No Viewing)', category: SERVICE_TYPE_CATEGORY, pricingType: 'flat', defaultPrice: null, sortOrder: 4 },
  { serviceCode: GUS_SERVICE_CODES.VETERANS_GRAVESIDE_BURIAL_SERVICE_ONLY, displayName: 'U.S. Veterans, Graveside Burial Service Only (No Viewing)', category: SERVICE_TYPE_CATEGORY, pricingType: 'flat', defaultPrice: null, sortOrder: 5 },
  { serviceCode: GUS_SERVICE_CODES.DIRECT_ENTOMBMENT, displayName: 'Direct Entombment (Embalming Required)', category: SERVICE_TYPE_CATEGORY, pricingType: 'flat', defaultPrice: null, sortOrder: 6 },
].map((entry) => Object.freeze(entry)));

/**
 * Gus Phase 5C-3 (administrator-managed price catalog). The display
 * categories Gus Camacho Jr.'s Settings › Price Catalog starts with — the
 * names the funeral home suggested, in this order. A starting point only:
 * an administrator renames, reorders, adds and deactivates categories in
 * the app. No item is filed under one and no price comes with them.
 */
export const GUS_STARTER_CATALOG_CATEGORIES: readonly string[] = Object.freeze([
  'Funeral Services',
  'Cremation Services',
  'Burial Services',
  'Merchandise',
  'Transportation',
  'Documents and Permits',
  'Additional Services',
]);
