import { describe, expect, it } from 'vitest';
import {
  calculateOrderTotals,
  catalogItemRows,
  catalogWithOrderSnapshots,
  normalizeCatalogItemSelections,
  normalizeSelections,
  selectionsFromLineItems,
  MAX_CATALOG_ITEM_QUANTITY,
} from './calculateOrder';
import { diffSelections } from './auditDiff';
import type { ServiceCatalogItem } from '../../types/serviceCatalog';

/**
 * Gus Phase 5C-3 (administrator-managed price catalog). Catalog items on a
 * case order — the pure pricing engine half: selection clamping, charging,
 * reconstruction from saved lines, saved-price preservation and the audit
 * diff. All prices are fictional test values.
 */

const ORG = 'gus-camacho-jr';
function row(overrides: Partial<ServiceCatalogItem>): ServiceCatalogItem {
  return {
    id: `row-${overrides.serviceCode}`,
    organizationId: ORG,
    serviceCode: 'X',
    displayName: 'Item',
    category: 'catalog_item',
    pricingType: 'flat',
    defaultPrice: 1_000,
    isActive: true,
    sortOrder: 1000,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const CATALOG = [
  row({ serviceCode: 'DIRECT_CREMATION', displayName: 'Direct Cremation', category: 'service_type', defaultPrice: 300_000, sortOrder: 1 }),
  row({ serviceCode: 'TEST_COPY', displayName: 'Test Certified Copy', pricingType: 'per_unit', defaultPrice: 2_550, sortOrder: 1010 }),
  row({ serviceCode: 'TEST_TRANSPORT', displayName: 'Test Transport', pricingType: 'flat', defaultPrice: 12_345, sortOrder: 1020 }),
  row({ serviceCode: 'TEST_UNPRICED', displayName: 'Test Unpriced', defaultPrice: null, sortOrder: 1030 }),
  row({ serviceCode: 'TEST_RETIRED', displayName: 'Test Retired', isActive: false, sortOrder: 1040 }),
];

const base = { weightTier: 'under_200' as const, serviceTypeCode: 'DIRECT_CREMATION' };

describe('normalizeCatalogItemSelections', () => {
  it('drops malformed rows, truncates and caps quantities, and merges repeated codes', () => {
    expect(
      normalizeCatalogItemSelections([
        { serviceCode: ' TEST_COPY ', quantity: 2.9 },
        { serviceCode: 'TEST_COPY', quantity: 3 },
        { serviceCode: 'TEST_TRANSPORT', quantity: 0 },
        { serviceCode: 'TEST_TRANSPORT', quantity: -4 },
        { serviceCode: '', quantity: 1 },
        { quantity: 1 },
        'TEST_COPY',
        null,
        { serviceCode: 'TEST_BIG', quantity: 10_000 },
        { serviceCode: 'TEST_NAN', quantity: Number.NaN },
      ]),
    ).toEqual([
      { serviceCode: 'TEST_COPY', quantity: 5 },
      { serviceCode: 'TEST_BIG', quantity: MAX_CATALOG_ITEM_QUANTITY },
    ]);
    expect(normalizeCatalogItemSelections('nope')).toEqual([]);
  });

  it('normalizeSelections includes catalogItems only when there are some (other organizations unchanged)', () => {
    expect('catalogItems' in normalizeSelections({ weightTier: 'under_200' })).toBe(false);
    expect('catalogItems' in normalizeSelections({ weightTier: 'under_200', catalogItems: [] })).toBe(false);
    expect(normalizeSelections({ catalogItems: [{ serviceCode: 'TEST_COPY', quantity: 1 }] }).catalogItems).toEqual([{ serviceCode: 'TEST_COPY', quantity: 1 }]);
  });
});

describe('calculateOrderTotals — catalog items', () => {
  it('charges per-unit items times the quantity and flat items once, priced only from the catalog', () => {
    const totals = calculateOrderTotals(CATALOG, {
      ...normalizeSelections(base),
      catalogItems: [
        { serviceCode: 'TEST_COPY', quantity: 3 },
        { serviceCode: 'TEST_TRANSPORT', quantity: 7 },
      ],
    });
    expect(totals.lineItems.map((l) => [l.serviceCode, l.quantity, l.unitPrice, l.lineTotal])).toEqual([
      ['DIRECT_CREMATION', 1, 300_000, 300_000],
      ['TEST_COPY', 3, 2_550, 7_650],
      ['TEST_TRANSPORT', 1, 12_345, 12_345],
    ]);
    expect(totals.total).toBe(319_995);
    expect(totals.lineItems[1].metadata).toEqual({ serviceRole: 'catalog_item' });
  });

  it('reports an unpriced item instead of charging $0, and never charges an inactive item, a service type or an unknown code', () => {
    const totals = calculateOrderTotals(CATALOG, {
      ...normalizeSelections({ weightTier: 'under_200' }),
      catalogItems: [
        { serviceCode: 'TEST_UNPRICED', quantity: 1 },
        { serviceCode: 'TEST_RETIRED', quantity: 1 },
        { serviceCode: 'DIRECT_CREMATION', quantity: 1 },
        { serviceCode: 'SOME_OTHER_ORG_CODE', quantity: 1 },
      ],
    });
    expect(totals.lineItems).toEqual([]);
    expect(totals.total).toBe(0);
    expect(totals.unpricedItems.map((i) => i.serviceCode)).toEqual(['TEST_UNPRICED']);
  });

  it('catalogItemRows lists only active catalog items, in display order', () => {
    expect(catalogItemRows(CATALOG).map((i) => i.serviceCode)).toEqual(['TEST_COPY', 'TEST_TRANSPORT', 'TEST_UNPRICED']);
  });

  it('selectionsFromLineItems reconstructs the catalog items from the saved lines', () => {
    const selections = { ...normalizeSelections(base), catalogItems: [{ serviceCode: 'TEST_COPY', quantity: 2 }, { serviceCode: 'TEST_TRANSPORT', quantity: 1 }] };
    const { lineItems } = calculateOrderTotals(CATALOG, selections);
    expect(selectionsFromLineItems(lineItems)).toEqual(selections);
  });
});

describe('catalogWithOrderSnapshots — an order keeps the prices it was saved with', () => {
  const saved = calculateOrderTotals(CATALOG, { ...normalizeSelections(base), catalogItems: [{ serviceCode: 'TEST_COPY', quantity: 2 }] }).lineItems;

  it('re-prices nothing already on the order after the catalog price changes', () => {
    const repriced = CATALOG.map((item) =>
      item.serviceCode === 'TEST_COPY' ? { ...item, defaultPrice: 9_999, displayName: 'Renamed Copy' } : item.serviceCode === 'DIRECT_CREMATION' ? { ...item, defaultPrice: 999_999 } : item,
    );
    const catalog = catalogWithOrderSnapshots(repriced, saved);
    const next = calculateOrderTotals(catalog, { ...normalizeSelections(base), catalogItems: [{ serviceCode: 'TEST_COPY', quantity: 3 }, { serviceCode: 'TEST_TRANSPORT', quantity: 1 }] });
    expect(next.lineItems.map((l) => [l.serviceCode, l.description, l.unitPrice, l.lineTotal])).toEqual([
      ['DIRECT_CREMATION', 'Direct Cremation', 300_000, 300_000],
      ['TEST_COPY', 'Test Certified Copy', 2_550, 7_650],
      // newly added: today's catalog price
      ['TEST_TRANSPORT', 'Test Transport', 12_345, 12_345],
    ]);
  });

  it('keeps a deactivated or now-unpriced item on the order at its saved price', () => {
    const changed = CATALOG.map((item) => (item.serviceCode === 'TEST_COPY' ? { ...item, isActive: false } : item.serviceCode === 'DIRECT_CREMATION' ? { ...item, defaultPrice: null } : item));
    const next = calculateOrderTotals(catalogWithOrderSnapshots(changed, saved), selectionsFromLineItems(saved));
    expect(next.unpricedItems).toEqual([]);
    expect(next.total).toBe(300_000 + 5_100);
  });

  it('honors a saved line whose row the browser was not sent (inactive), by its own metadata', () => {
    const activeOnly = CATALOG.filter((item) => item.serviceCode !== 'TEST_COPY');
    const next = calculateOrderTotals(catalogWithOrderSnapshots(activeOnly, saved), selectionsFromLineItems(saved));
    expect(next.lineItems.find((l) => l.serviceCode === 'TEST_COPY')).toMatchObject({ unitPrice: 2_550, quantity: 2 });
  });

  it('returns the catalog unchanged for an order with no service lines', () => {
    expect(catalogWithOrderSnapshots(CATALOG, [])).toBe(CATALOG);
  });
});

describe('diffSelections — catalog items', () => {
  it('records each added, removed and re-quantified item with its exact cents delta', () => {
    const previous = { ...normalizeSelections(base), catalogItems: [{ serviceCode: 'TEST_COPY', quantity: 1 }, { serviceCode: 'TEST_TRANSPORT', quantity: 1 }] };
    const next = { ...normalizeSelections(base), catalogItems: [{ serviceCode: 'TEST_COPY', quantity: 3 }, { serviceCode: 'TEST_UNPRICED', quantity: 1 }] };
    const entries = diffSelections(CATALOG, previous, next);
    expect(entries.map((e) => [e.action, e.previousValue, e.newValue, e.amountDeltaCents])).toEqual([
      ['catalog_item_quantity_changed', '1', '3', 5_100],
      ['catalog_item_removed', '1', '0', -12_345],
      ['catalog_item_added', '0', '1', 0],
    ]);
    expect(entries[0].description).toBe('Added: 2 × Test Certified Copy, +$51.00');
    expect(entries[1].description).toBe('Removed: 1 × Test Transport, -$123.45');
  });
});
