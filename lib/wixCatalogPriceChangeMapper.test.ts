import { describe, expect, it } from 'vitest';
import { buildWixCatalogPriceChangeData, mapWixCatalogPriceChangeItem } from './wixCatalogPriceChangeMapper';
import type { CatalogPriceChange } from '../types/catalogPriceChange';

const row: CatalogPriceChange = {
  id: 'cpc-1',
  organizationId: 'gus-camacho-jr',
  itemType: 'service',
  itemId: 'item-1',
  itemCode: 'DIRECT_CREMATION',
  itemName: 'Direct Cremation',
  previousPrice: null,
  newPrice: 100_000,
  changedBy: 'identity-fictional',
  changedAt: '2026-11-02T00:00:00.000Z',
  reason: null,
  correlationId: 'corr-1',
};

describe('catalogPriceChanges mapper (proposed collection, 2026-11)', () => {
  it('round-trips a row, null prices included', () => {
    expect(mapWixCatalogPriceChangeItem(buildWixCatalogPriceChangeData(row))).toEqual(row);
  });

  it('drops a malformed row rather than inventing values', () => {
    expect(mapWixCatalogPriceChangeItem({ ...buildWixCatalogPriceChangeData(row), itemType: 'tax' })).toBeNull();
    expect(mapWixCatalogPriceChangeItem({ ...buildWixCatalogPriceChangeData(row), newPrice: -1 })).toBeNull();
    expect(mapWixCatalogPriceChangeItem({ ...buildWixCatalogPriceChangeData(row), newPrice: 10.5 })).toBeNull();
    expect(mapWixCatalogPriceChangeItem(undefined)).toBeNull();
  });
});
