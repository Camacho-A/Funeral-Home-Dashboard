import { SERVICE_CODES } from '../pricing/serviceCodes';
import { GUS_CAMACHO_ORGANIZATION_ID } from '../organization/organizationProfiles';
import { GUS_SERVICE_CATALOG } from './gusServiceCatalog';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Platform-owned
 * starter service catalog content — plain in-code data, the same
 * "materialize into organization-owned rows, never a shared cross-org
 * template row" pattern as `domain/onboarding/starterWorkflow.ts`.
 * `services/organizationProvisioningService.ts`'s `seedServiceCatalog`
 * writes a fresh, independent `serviceCatalog` row per entry for the new
 * organization — never a reference to Manor's Cremation's own rows (see
 * `types/serviceCatalog.ts`).
 *
 * 2026-10 (Gus Camacho Jr. service catalog): the generic starter keeps the
 * Phase 19C service *structure* (codes, names, categories — what the
 * pricing engine knows how to interpret) but carries NO prices. It used to
 * copy Manor's Cremation's exact v1 prices into every newly onboarded
 * organization, which presented one funeral home's private price list as
 * another's. Every price now starts as null ("price not set"); the new
 * organization's administrator enters its own in Settings › Services &
 * Pricing, and until then the server refuses to save a case order that
 * selects an unpriced item (never charging an invented amount). An
 * organization that supplied its own catalog gets exactly that instead —
 * see `resolveStarterServiceCatalog` below.
 */
export type StarterServiceCatalogEntry = {
  serviceCode: string;
  displayName: string;
  category: string;
  pricingType: string;
  /** Integer cents, or null = "price not set" (see types/serviceCatalog.ts). */
  defaultPrice: number | null;
  sortOrder: number;
};

export const STARTER_SERVICE_CATALOG: readonly StarterServiceCatalogEntry[] = [
  { serviceCode: SERVICE_CODES.DIRECT_CREMATION, displayName: 'Direct Cremation', category: 'base', pricingType: 'flat', defaultPrice: null, sortOrder: 1 },
  { serviceCode: SERVICE_CODES.WEIGHT_SURCHARGE_201_250, displayName: 'Weight Surcharge (201–250 lb)', category: 'weight_surcharge', pricingType: 'flat', defaultPrice: null, sortOrder: 2 },
  { serviceCode: SERVICE_CODES.WEIGHT_SURCHARGE_251_300, displayName: 'Weight Surcharge (251–300 lb)', category: 'weight_surcharge', pricingType: 'flat', defaultPrice: null, sortOrder: 2 },
  { serviceCode: SERVICE_CODES.EXTRA_DEATH_CERTIFICATE, displayName: 'Extra Death Certificate', category: 'addon', pricingType: 'per_unit', defaultPrice: null, sortOrder: 3 },
  { serviceCode: SERVICE_CODES.MAIL_CREMATED_REMAINS, displayName: 'Mail Cremated Remains', category: 'addon', pricingType: 'flat', defaultPrice: null, sortOrder: 4 },
];

/** Organizations that supplied their own catalog definition. Keyed by
    organization id; anything not listed gets the generic, price-less
    STARTER_SERVICE_CATALOG. */
const ORGANIZATION_SERVICE_CATALOGS: Readonly<Record<string, readonly StarterServiceCatalogEntry[]>> = {
  [GUS_CAMACHO_ORGANIZATION_ID]: GUS_SERVICE_CATALOG,
};

/** The catalog template onboarding seeds for `organizationId`. */
export function resolveStarterServiceCatalog(organizationId: string): readonly StarterServiceCatalogEntry[] {
  return ORGANIZATION_SERVICE_CATALOGS[organizationId] ?? STARTER_SERVICE_CATALOG;
}
