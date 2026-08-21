import { describe, expect, it } from 'vitest';
import {
  calculateMerchandiseLineItems,
  calculateOrderTotalsWithMerchandise,
  normalizeMerchandiseSelections,
  merchandiseSelectionsFromLineItems,
  sumLineTotalsByKind,
  type CalculatedLineItem,
} from './calculateOrder';
import type { MerchandiseProduct } from '../../types/merchandiseProduct';
import type { ServiceCatalogItem } from '../../types/serviceCatalog';
import { SERVICE_CODES } from './serviceCodes';

function product(overrides: Partial<MerchandiseProduct> & Pick<MerchandiseProduct, 'id' | 'sku' | 'name' | 'retailPrice'>): MerchandiseProduct {
  return {
    organizationId: 'org-1',
    description: null,
    category: 'urn',
    cost: 5000,
    taxable: false,
    isActive: true,
    trackInventory: true,
    reorderPoint: null,
    defaultLocationId: null,
    imageStorageKey: null,
    familyVisible: false,
    supplierName: null,
    parentProductId: null,
    createdAt: 't',
    updatedAt: 't',
    ...overrides,
  };
}

const OAK_URN = product({ id: 'p-urn', sku: 'URN-OAK', name: 'Oak Urn', retailPrice: 39000, category: 'urn' });
const CASKET = product({ id: 'p-casket', sku: 'CASKET-PINE', name: 'Pine Casket', retailPrice: 120000, category: 'casket' });
const INACTIVE = product({ id: 'p-old', sku: 'OLD', name: 'Discontinued', retailPrice: 100, isActive: false });

const SERVICE_CATALOG: ServiceCatalogItem[] = [
  { id: 's1', organizationId: 'org-1', serviceCode: SERVICE_CODES.DIRECT_CREMATION, displayName: 'Direct Cremation', category: 'base', pricingType: 'flat', defaultPrice: 89000, isActive: true, sortOrder: 1, createdAt: 't', updatedAt: 't' },
];

describe('normalizeMerchandiseSelections', () => {
  it('drops invalid rows, clamps quantity, aggregates duplicate (product, location)', () => {
    const result = normalizeMerchandiseSelections([
      { productId: 'p-urn', locationId: 'loc-1', quantity: 2 },
      { productId: 'p-urn', locationId: 'loc-1', quantity: 1 }, // aggregates to 3
      { productId: 'p-urn', locationId: 'loc-2', quantity: 1 }, // different location, separate
      { productId: '', locationId: 'loc-1', quantity: 5 }, // no productId → dropped
      { productId: 'p-casket', locationId: 'loc-1', quantity: 0 }, // zero → dropped
      { productId: 'p-casket', locationId: 'loc-1', quantity: -3 }, // negative → dropped
    ]);
    expect(result).toEqual([
      { productId: 'p-urn', locationId: 'loc-1', quantity: 3 },
      { productId: 'p-urn', locationId: 'loc-2', quantity: 1 },
    ]);
  });

  it('returns [] for non-array input', () => {
    expect(normalizeMerchandiseSelections(undefined)).toEqual([]);
    expect(normalizeMerchandiseSelections('nope')).toEqual([]);
  });
});

describe('calculateMerchandiseLineItems', () => {
  it('snapshots retailPrice and name, carries product identity in metadata, marks lineKind merchandise', () => {
    const lines = calculateMerchandiseLineItems([OAK_URN], [{ productId: 'p-urn', locationId: 'loc-1', quantity: 2 }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      lineKind: 'merchandise',
      serviceCode: 'URN-OAK',
      description: 'Oak Urn',
      quantity: 2,
      unitPrice: 39000,
      lineTotal: 78000,
      metadata: { productId: 'p-urn', sku: 'URN-OAK', locationId: 'loc-1' },
    });
  });

  it('omits a selection whose product is missing or inactive (never throws)', () => {
    const lines = calculateMerchandiseLineItems(
      [OAK_URN, INACTIVE],
      [
        { productId: 'p-urn', locationId: 'loc-1', quantity: 1 },
        { productId: 'p-old', locationId: 'loc-1', quantity: 1 }, // inactive → omitted
        { productId: 'p-missing', locationId: 'loc-1', quantity: 1 }, // absent → omitted
      ],
    );
    expect(lines.map((l) => l.serviceCode)).toEqual(['URN-OAK']);
  });

  it('orders merchandise by category then name, with sortOrder after all services', () => {
    const lines = calculateMerchandiseLineItems(
      [OAK_URN, CASKET],
      [
        { productId: 'p-urn', locationId: 'loc-1', quantity: 1 },
        { productId: 'p-casket', locationId: 'loc-1', quantity: 1 },
      ],
    );
    // casket sortOrder(2) before urn sortOrder(1)? registry: urn=1, casket=2 → urn first
    expect(lines.map((l) => l.description)).toEqual(['Oak Urn', 'Pine Casket']);
    expect(lines.every((l) => l.sortOrder >= 100000)).toBe(true);
  });
});

describe('calculateOrderTotalsWithMerchandise', () => {
  it('combines service and merchandise lines into one total', () => {
    const totals = calculateOrderTotalsWithMerchandise(SERVICE_CATALOG, [OAK_URN], {
      services: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false },
      merchandise: [{ productId: 'p-urn', locationId: 'loc-1', quantity: 1 }],
    });
    expect(totals.subtotal).toBe(89000 + 39000);
    expect(totals.total).toBe(128000);
    expect(totals.lineItems.filter((l) => l.lineKind === 'service')).toHaveLength(1);
    expect(totals.lineItems.filter((l) => l.lineKind === 'merchandise')).toHaveLength(1);
  });
});

describe('merchandiseSelectionsFromLineItems', () => {
  it('reconstructs merchandise selections from persisted line metadata, ignoring service lines', () => {
    const lineItems: CalculatedLineItem[] = [
      { lineKind: 'service', serviceCode: 'DIRECT_CREMATION', description: 'Direct Cremation', quantity: 1, unitPrice: 89000, lineTotal: 89000, sortOrder: 1, metadata: null },
      { lineKind: 'merchandise', serviceCode: 'URN-OAK', description: 'Oak Urn', quantity: 2, unitPrice: 39000, lineTotal: 78000, sortOrder: 100000, metadata: { productId: 'p-urn', sku: 'URN-OAK', locationId: 'loc-1' } },
    ];
    expect(merchandiseSelectionsFromLineItems(lineItems)).toEqual([{ productId: 'p-urn', locationId: 'loc-1', quantity: 2 }]);
  });
});

describe('sumLineTotalsByKind', () => {
  it('splits service vs merchandise totals', () => {
    const split = sumLineTotalsByKind([
      { lineKind: 'service', lineTotal: 89000 },
      { lineKind: 'merchandise', lineTotal: 78000 },
      { lineKind: 'merchandise', lineTotal: 12000 },
      { lineKind: 'surcharge', lineTotal: 500 }, // reserved kinds count as non-merchandise (service side)
    ]);
    expect(split).toEqual({ service: 89500, merchandise: 90000 });
  });
});
