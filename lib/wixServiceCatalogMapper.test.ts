import { describe, expect, it } from 'vitest';
import { buildWixServiceCatalogData, mapWixServiceCatalogItem } from './wixServiceCatalogMapper';
import type { ServiceCatalogItem } from '../types/serviceCatalog';

/** 2026-10 (Gus Camacho Jr. service catalog): a null ("price not set")
    defaultPrice round-trips; it must never drop the row or become $0. */
const ROW: ServiceCatalogItem = {
  id: 'svc-1', organizationId: 'gus-camacho-jr', serviceCode: 'DIRECT_CREMATION', displayName: 'Direct Cremation',
  category: 'service_type', pricingType: 'flat', defaultPrice: null, ftcClass: null, isActive: true, sortOrder: 1,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
};

describe('wixServiceCatalogMapper', () => {
  it('round-trips an unpriced row as null', () => {
    expect(mapWixServiceCatalogItem(buildWixServiceCatalogData(ROW))).toEqual(ROW);
  });

  it('round-trips a priced row', () => {
    expect(mapWixServiceCatalogItem(buildWixServiceCatalogData({ ...ROW, defaultPrice: 250_000 }))?.defaultPrice).toBe(250_000);
  });

  it('still rejects a row with a missing or non-numeric price', () => {
    const data = buildWixServiceCatalogData(ROW);
    expect(mapWixServiceCatalogItem({ ...data, defaultPrice: undefined })).toBeNull();
    expect(mapWixServiceCatalogItem({ ...data, defaultPrice: '100' })).toBeNull();
  });
});
