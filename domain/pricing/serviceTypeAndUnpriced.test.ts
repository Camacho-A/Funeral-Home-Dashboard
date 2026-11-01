import { describe, expect, it } from 'vitest';
import type { ServiceCatalogItem } from '../../types/serviceCatalog';
import type { ServiceSelections } from '../../types/caseOrder';
import {
  calculateOrderTotals,
  calculateOrderTotalsWithMerchandise,
  isCatalogItemPriced,
  normalizeSelections,
  resolveServiceTypeCode,
  selectionsFromLineItems,
  serviceTypeItems,
} from './calculateOrder';
import { diffSelections } from './auditDiff';
import { GUS_SERVICE_CATALOG } from '../onboarding/gusServiceCatalog';

/**
 * 2026-10 (Gus Camacho Jr. service catalog). The pricing engine's
 * service-type selection and "price not set" handling — and proof that a
 * catalog without either (Manors) calculates exactly as before.
 */

const NOW = '2026-07-20T00:00:00.000Z';

function catalogItem(overrides: Partial<ServiceCatalogItem>): ServiceCatalogItem {
  return {
    id: `svc-${overrides.serviceCode}`,
    organizationId: 'org-1',
    serviceCode: 'X',
    displayName: 'X',
    category: 'addon',
    pricingType: 'flat',
    defaultPrice: 0,
    isActive: true,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const MANORS_CATALOG: ServiceCatalogItem[] = [
  catalogItem({ serviceCode: 'DIRECT_CREMATION', displayName: 'Direct Cremation', category: 'base', defaultPrice: 89_000, sortOrder: 1 }),
  catalogItem({ serviceCode: 'WEIGHT_SURCHARGE_201_250', displayName: 'Weight Surcharge (201–250 lb)', category: 'weight_surcharge', defaultPrice: 29_000, sortOrder: 2 }),
  catalogItem({ serviceCode: 'WEIGHT_SURCHARGE_251_300', displayName: 'Weight Surcharge (251–300 lb)', category: 'weight_surcharge', defaultPrice: 39_000, sortOrder: 2 }),
  catalogItem({ serviceCode: 'EXTRA_DEATH_CERTIFICATE', displayName: 'Extra Death Certificate', category: 'addon', pricingType: 'per_unit', defaultPrice: 2_500, sortOrder: 3 }),
  catalogItem({ serviceCode: 'MAIL_CREMATED_REMAINS', displayName: 'Mail Cremated Remains', category: 'addon', defaultPrice: 18_500, sortOrder: 4 }),
];

/** Gus's real catalog definition (every price null), as org rows. */
const GUS_CATALOG: ServiceCatalogItem[] = GUS_SERVICE_CATALOG.map((entry) =>
  catalogItem({ ...entry, organizationId: 'gus-camacho-jr' }),
);

function withPrice(catalog: ServiceCatalogItem[], serviceCode: string, defaultPrice: number | null): ServiceCatalogItem[] {
  return catalog.map((item) => (item.serviceCode === serviceCode ? { ...item, defaultPrice } : item));
}

const NO_ADDONS: ServiceSelections = {
  weightTier: 'under_200',
  extraDeathCertificateQuantity: 0,
  mailCremated: false,
  keepsakeTransferQuantity: 0,
  urnTransfer: false,
  shipping: false,
};

describe('Manors (no service_type rows) — unchanged', () => {
  it('still always includes the base service and reports nothing unpriced', () => {
    const result = calculateOrderTotals(MANORS_CATALOG, { ...NO_ADDONS, weightTier: '201_250', extraDeathCertificateQuantity: 2, mailCremated: true });
    expect(result.lineItems.map((l) => l.serviceCode)).toEqual([
      'DIRECT_CREMATION',
      'WEIGHT_SURCHARGE_201_250',
      'EXTRA_DEATH_CERTIFICATE',
      'MAIL_CREMATED_REMAINS',
    ]);
    expect(result.lineItems.every((l) => l.metadata === null)).toBe(true);
    expect(result.total).toBe(141_500);
    expect(result.unpricedItems).toEqual([]);
  });

  it('ignores a serviceTypeCode naming a Manors base/addon row — never charges it twice or as a service type', () => {
    const result = calculateOrderTotals(MANORS_CATALOG, { ...NO_ADDONS, serviceTypeCode: 'MAIL_CREMATED_REMAINS' });
    expect(result.lineItems.map((l) => l.serviceCode)).toEqual(['DIRECT_CREMATION']);
    const base = calculateOrderTotals(MANORS_CATALOG, { ...NO_ADDONS, serviceTypeCode: 'DIRECT_CREMATION' });
    expect(base.lineItems).toHaveLength(1);
    expect(base.total).toBe(89_000);
  });

  it('round-trips a Manors order without ever producing a serviceTypeCode key', () => {
    const result = calculateOrderTotals(MANORS_CATALOG, { ...NO_ADDONS, weightTier: '251_300' });
    const reconstructed = selectionsFromLineItems(result.lineItems);
    expect('serviceTypeCode' in reconstructed).toBe(false);
    expect(reconstructed).toEqual({ ...NO_ADDONS, weightTier: '251_300' });
  });
});

describe('service type selection', () => {
  const PRICED = withPrice(GUS_CATALOG, 'CREMATION_WITH_VIEWING', 450_000);

  it('charges nothing — and never auto-includes Direct Cremation — when no service type is chosen', () => {
    const result = calculateOrderTotals(PRICED, NO_ADDONS);
    expect(result.lineItems).toEqual([]);
    expect(result.unpricedItems).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('charges exactly the one chosen, priced service type, marked as the order\'s service type', () => {
    const result = calculateOrderTotals(PRICED, { ...NO_ADDONS, serviceTypeCode: 'CREMATION_WITH_VIEWING' });
    expect(result.lineItems).toEqual([
      {
        lineKind: 'service',
        serviceCode: 'CREMATION_WITH_VIEWING',
        description: 'Cremation with Viewing',
        quantity: 1,
        unitPrice: 450_000,
        lineTotal: 450_000,
        sortOrder: 3,
        metadata: { serviceRole: 'service_type' },
      },
    ]);
    expect(result.total).toBe(450_000);
    expect(result.unpricedItems).toEqual([]);
  });

  it('ignores an unknown, inactive or non-service_type code (treated as none)', () => {
    expect(calculateOrderTotals(PRICED, { ...NO_ADDONS, serviceTypeCode: 'NOT_A_SERVICE' }).lineItems).toEqual([]);
    const inactive = PRICED.map((item) => (item.serviceCode === 'CREMATION_WITH_VIEWING' ? { ...item, isActive: false } : item));
    expect(calculateOrderTotals(inactive, { ...NO_ADDONS, serviceTypeCode: 'CREMATION_WITH_VIEWING' }).lineItems).toEqual([]);
    expect(resolveServiceTypeCode(PRICED, 'CREMATION_WITH_VIEWING')).toBe('CREMATION_WITH_VIEWING');
    expect(resolveServiceTypeCode(PRICED, 'NOT_A_SERVICE')).toBeNull();
    expect(resolveServiceTypeCode(MANORS_CATALOG, 'DIRECT_CREMATION')).toBeNull();
    expect(resolveServiceTypeCode(PRICED, null)).toBeNull();
  });

  it('lists the service types in catalog order', () => {
    expect(serviceTypeItems(GUS_CATALOG).map((i) => i.serviceCode)).toEqual(GUS_SERVICE_CATALOG.map((e) => e.serviceCode));
    expect(serviceTypeItems(MANORS_CATALOG)).toEqual([]);
  });

  it('reconstructs serviceTypeCode from the persisted line\'s marker (not from its serviceCode)', () => {
    const priced = withPrice(GUS_CATALOG, 'DIRECT_CREMATION', 300_000);
    const result = calculateOrderTotals(priced, { ...NO_ADDONS, serviceTypeCode: 'DIRECT_CREMATION' });
    expect(selectionsFromLineItems(result.lineItems)).toEqual({ ...NO_ADDONS, serviceTypeCode: 'DIRECT_CREMATION' });
  });
});

describe('unpriced items (defaultPrice: null)', () => {
  it('reports a chosen unpriced service type instead of charging any amount for it', () => {
    const result = calculateOrderTotals(GUS_CATALOG, { ...NO_ADDONS, serviceTypeCode: 'DIRECT_ENTOMBMENT' });
    expect(result.lineItems).toEqual([]);
    expect(result.subtotal).toBe(0);
    expect(result.total).toBe(0);
    expect(result.unpricedItems).toEqual([
      { serviceCode: 'DIRECT_ENTOMBMENT', displayName: 'Direct Entombment (Embalming Required)', quantity: 1, sortOrder: 6 },
    ]);
  });

  it('reports an unpriced Manors-style addon with its quantity, keeping priced lines intact', () => {
    const catalog = withPrice(MANORS_CATALOG, 'EXTRA_DEATH_CERTIFICATE', null);
    const result = calculateOrderTotals(catalog, { ...NO_ADDONS, extraDeathCertificateQuantity: 3 });
    expect(result.lineItems.map((l) => l.serviceCode)).toEqual(['DIRECT_CREMATION']);
    expect(result.total).toBe(89_000);
    expect(result.unpricedItems).toEqual([{ serviceCode: 'EXTRA_DEATH_CERTIFICATE', displayName: 'Extra Death Certificate', quantity: 3, sortOrder: 3 }]);
  });

  it('does not report an unpriced item that is not selected', () => {
    expect(calculateOrderTotals(GUS_CATALOG, NO_ADDONS).unpricedItems).toEqual([]);
  });

  it('carries unpricedItems through the merchandise-inclusive calculation', () => {
    const result = calculateOrderTotalsWithMerchandise(GUS_CATALOG, [], { services: { ...NO_ADDONS, serviceTypeCode: 'CREMATION_WITH_VIEWING' }, merchandise: [] });
    expect(result.unpricedItems.map((i) => i.serviceCode)).toEqual(['CREMATION_WITH_VIEWING']);
    expect(result.total).toBe(0);
  });

  it('treats only a non-negative integer as a price — never null, negative, or fractional cents', () => {
    expect(isCatalogItemPriced({ defaultPrice: 0 })).toBe(true);
    expect(isCatalogItemPriced({ defaultPrice: 12_345 })).toBe(true);
    expect(isCatalogItemPriced({ defaultPrice: null })).toBe(false);
    expect(isCatalogItemPriced({ defaultPrice: -1 })).toBe(false);
    expect(isCatalogItemPriced({ defaultPrice: 10.5 })).toBe(false);
  });
});

describe('normalizeSelections — serviceTypeCode', () => {
  it('keeps a trimmed code and omits the key entirely when none/invalid was sent', () => {
    expect(normalizeSelections({ serviceTypeCode: '  CREMATION_WITH_VIEWING ' }).serviceTypeCode).toBe('CREMATION_WITH_VIEWING');
    expect('serviceTypeCode' in normalizeSelections({})).toBe(false);
    expect('serviceTypeCode' in normalizeSelections({ serviceTypeCode: '' })).toBe(false);
    expect('serviceTypeCode' in normalizeSelections({ serviceTypeCode: 42 })).toBe(false);
    expect('serviceTypeCode' in normalizeSelections({ serviceTypeCode: 'X'.repeat(101) })).toBe(false);
  });
});

describe('diffSelections — service type', () => {
  it('records a service type change with the price delta', () => {
    const catalog = withPrice(withPrice(GUS_CATALOG, 'DIRECT_CREMATION', 300_000), 'CREMATION_WITH_VIEWING', 450_050);
    const entries = diffSelections(catalog, { ...NO_ADDONS, serviceTypeCode: 'DIRECT_CREMATION' }, { ...NO_ADDONS, serviceTypeCode: 'CREMATION_WITH_VIEWING' });
    expect(entries).toEqual([
      {
        action: 'service_type_changed',
        previousValue: 'Direct Cremation',
        newValue: 'Cremation with Viewing',
        amountDeltaCents: 150_050,
        description: 'Changed: Service, Direct Cremation → Cremation with Viewing, +$1,500.50',
      },
    ]);
  });

  it('labels an unpriced side instead of inventing a dollar delta', () => {
    const catalog = withPrice(GUS_CATALOG, 'CREMATION_WITH_VIEWING', 450_000);
    const [entry] = diffSelections(catalog, { ...NO_ADDONS, serviceTypeCode: 'DIRECT_CREMATION' }, { ...NO_ADDONS, serviceTypeCode: 'CREMATION_WITH_VIEWING' });
    expect(entry.amountDeltaCents).toBe(0);
    expect(entry.description).toContain('price not set');
  });

  it('never diffs absent vs null (a Manors order)', () => {
    expect(diffSelections(MANORS_CATALOG, NO_ADDONS, { ...NO_ADDONS, serviceTypeCode: null })).toEqual([]);
  });
});
