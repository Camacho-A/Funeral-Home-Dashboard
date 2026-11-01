import { describe, expect, it } from 'vitest';
import { GUS_SERVICE_CATALOG, GUS_SERVICE_CODES } from './gusServiceCatalog';
import { STARTER_SERVICE_CATALOG, resolveStarterServiceCatalog } from './starterServiceCatalog';
import { GUS_CAMACHO_ORGANIZATION_ID } from '../organization/organizationProfiles';
import { serviceCatalogFixtures, gusServiceCatalogItemId } from '../../services/__mocks__/pricingFixtures';
import { DEFAULT_ORGANIZATION_ID, GUS_ORGANIZATION_ID } from '../../services/__mocks__/organizationIds';

/**
 * 2026-10 (Gus Camacho Jr. service catalog). The catalog definition, its
 * mock fixture rows, and onboarding's template resolution.
 */
describe('GUS_SERVICE_CATALOG', () => {
  it('is exactly the six supplied services, in the supplied order', () => {
    expect(GUS_SERVICE_CATALOG.map((e) => e.displayName)).toEqual([
      'Direct Cremation',
      'Cremation with Final Goodbye',
      'Cremation with Viewing',
      'Graveside Burial Service Only (No Viewing)',
      'U.S. Veterans, Graveside Burial Service Only (No Viewing)',
      'Direct Entombment (Embalming Required)',
    ]);
    expect(GUS_SERVICE_CATALOG.map((e) => e.serviceCode)).toEqual([
      'DIRECT_CREMATION',
      'CREMATION_WITH_FINAL_GOODBYE',
      'CREMATION_WITH_VIEWING',
      'GRAVESIDE_BURIAL_SERVICE_ONLY',
      'VETERANS_GRAVESIDE_BURIAL_SERVICE_ONLY',
      'DIRECT_ENTOMBMENT',
    ]);
    expect(Object.values(GUS_SERVICE_CODES)).toEqual(GUS_SERVICE_CATALOG.map((e) => e.serviceCode));
    expect(GUS_SERVICE_CATALOG.map((e) => e.sortOrder)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('invents nothing: every price unset, every row a flat service type, no add-ons or surcharges', () => {
    for (const entry of GUS_SERVICE_CATALOG) {
      expect(entry.defaultPrice, entry.serviceCode).toBeNull();
      expect(entry.category).toBe('service_type');
      expect(entry.pricingType).toBe('flat');
    }
  });

  it('is immutable', () => {
    expect(Object.isFrozen(GUS_SERVICE_CATALOG)).toBe(true);
    expect(GUS_SERVICE_CATALOG.every((e) => Object.isFrozen(e))).toBe(true);
  });
});

describe('mock pricing fixtures', () => {
  it("seed Gus's rows from GUS_SERVICE_CATALOG, owned by gus-camacho-jr, all unpriced", () => {
    const gus = serviceCatalogFixtures.filter((i) => i.organizationId === GUS_ORGANIZATION_ID);
    expect(gus.map((i) => ({ serviceCode: i.serviceCode, displayName: i.displayName, category: i.category, pricingType: i.pricingType, defaultPrice: i.defaultPrice, sortOrder: i.sortOrder }))).toEqual(
      GUS_SERVICE_CATALOG.map((e) => ({ ...e })),
    );
    expect(gus.map((i) => i.id)).toEqual(GUS_SERVICE_CATALOG.map((e) => gusServiceCatalogItemId(e.serviceCode)));
    expect(gus.every((i) => i.isActive)).toBe(true);
  });

  it("leave Manors' eight priced rows as they were", () => {
    const manors = serviceCatalogFixtures.filter((i) => i.organizationId === DEFAULT_ORGANIZATION_ID);
    expect(manors.map((i) => [i.serviceCode, i.defaultPrice])).toEqual([
      ['DIRECT_CREMATION', 89_000],
      ['WEIGHT_SURCHARGE_201_250', 29_000],
      ['WEIGHT_SURCHARGE_251_300', 39_000],
      ['EXTRA_DEATH_CERTIFICATE', 2_500],
      ['MAIL_CREMATED_REMAINS', 18_500],
      ['KEEPSAKE_TRANSFER', 1_000],
      ['URN_TRANSFER', 3_500],
      ['SHIPPING', 18_500],
    ]);
  });
});

describe('resolveStarterServiceCatalog', () => {
  it('gives Gus its own catalog and every other organization the price-less generic starter', () => {
    expect(GUS_ORGANIZATION_ID).toBe(GUS_CAMACHO_ORGANIZATION_ID);
    expect(resolveStarterServiceCatalog(GUS_CAMACHO_ORGANIZATION_ID)).toBe(GUS_SERVICE_CATALOG);
    expect(resolveStarterServiceCatalog('some-new-funeral-home')).toBe(STARTER_SERVICE_CATALOG);
  });

  it("the generic starter never carries Manors' (or any) prices", () => {
    expect(STARTER_SERVICE_CATALOG.length).toBeGreaterThan(0);
    expect(STARTER_SERVICE_CATALOG.every((e) => e.defaultPrice === null)).toBe(true);
  });
});
