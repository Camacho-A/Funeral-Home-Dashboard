import { SERVICE_CODES } from '../pricing/serviceCodes';

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
 * Deliberate scope simplification: no other reference pricing exists in
 * this project yet, so this starter catalog reuses Manor's Cremation's
 * exact five v1 service codes/prices (Phase 19C) as a reasonable default
 * for a new cremation-home tenant — every new organization gets its own
 * independent rows seeded from this same template, immediately editable
 * (via direct Wix Data access; no in-app catalog-editing UI exists yet,
 * the same pre-existing gap Phase 19C already left open) without
 * affecting any other organization's catalog.
 */
export type StarterServiceCatalogEntry = {
  serviceCode: string;
  displayName: string;
  category: string;
  pricingType: string;
  defaultPrice: number;
  sortOrder: number;
};

export const STARTER_SERVICE_CATALOG: StarterServiceCatalogEntry[] = [
  { serviceCode: SERVICE_CODES.DIRECT_CREMATION, displayName: 'Direct Cremation', category: 'base', pricingType: 'flat', defaultPrice: 89_000, sortOrder: 1 },
  { serviceCode: SERVICE_CODES.WEIGHT_SURCHARGE_201_250, displayName: 'Weight Surcharge (201–250 lb)', category: 'weight_surcharge', pricingType: 'flat', defaultPrice: 29_000, sortOrder: 2 },
  { serviceCode: SERVICE_CODES.WEIGHT_SURCHARGE_251_300, displayName: 'Weight Surcharge (251–300 lb)', category: 'weight_surcharge', pricingType: 'flat', defaultPrice: 39_000, sortOrder: 2 },
  { serviceCode: SERVICE_CODES.EXTRA_DEATH_CERTIFICATE, displayName: 'Extra Death Certificate', category: 'addon', pricingType: 'per_unit', defaultPrice: 2_500, sortOrder: 3 },
  { serviceCode: SERVICE_CODES.MAIL_CREMATED_REMAINS, displayName: 'Mail Cremated Remains', category: 'addon', pricingType: 'flat', defaultPrice: 18_500, sortOrder: 4 },
];
