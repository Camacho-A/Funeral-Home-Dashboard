import { describe, expect, it } from 'vitest';
import type { ServiceCatalogItem } from '../../types/serviceCatalog';
import {
  MAX_EXTRA_DEATH_CERTIFICATE_QUANTITY,
  calculateAdjustment,
  calculateBalance,
  calculateOrderTotals,
  isValidWeightTier,
  normalizeSelections,
  weightTierServiceCode,
} from './calculateOrder';

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

describe('calculateOrderTotals', () => {
  it('charges only the base service for the minimal case (under 200 lb, no add-ons)', () => {
    const result = calculateOrderTotals(MANORS_CATALOG, {
      weightTier: 'under_200',
      extraDeathCertificateQuantity: 0,
      mailCremated: false,
    });
    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0].serviceCode).toBe('DIRECT_CREMATION');
    expect(result.subtotal).toBe(89_000);
    expect(result.total).toBe(89_000);
  });

  it('applies the 201–250 lb weight surcharge', () => {
    const result = calculateOrderTotals(MANORS_CATALOG, {
      weightTier: '201_250',
      extraDeathCertificateQuantity: 0,
      mailCremated: false,
    });
    expect(result.total).toBe(89_000 + 29_000);
    expect(result.lineItems.map((l) => l.serviceCode)).toEqual(['DIRECT_CREMATION', 'WEIGHT_SURCHARGE_201_250']);
  });

  it('applies the 251–300 lb weight surcharge', () => {
    const result = calculateOrderTotals(MANORS_CATALOG, {
      weightTier: '251_300',
      extraDeathCertificateQuantity: 0,
      mailCremated: false,
    });
    expect(result.total).toBe(89_000 + 39_000);
  });

  it('multiplies extra death certificate price by quantity', () => {
    const result = calculateOrderTotals(MANORS_CATALOG, {
      weightTier: 'under_200',
      extraDeathCertificateQuantity: 2,
      mailCremated: false,
    });
    const certLine = result.lineItems.find((l) => l.serviceCode === 'EXTRA_DEATH_CERTIFICATE');
    expect(certLine?.quantity).toBe(2);
    expect(certLine?.lineTotal).toBe(5_000);
    expect(result.total).toBe(89_000 + 5_000);
  });

  it('omits the death certificate line item entirely when quantity is 0', () => {
    const result = calculateOrderTotals(MANORS_CATALOG, {
      weightTier: 'under_200',
      extraDeathCertificateQuantity: 0,
      mailCremated: false,
    });
    expect(result.lineItems.some((l) => l.serviceCode === 'EXTRA_DEATH_CERTIFICATE')).toBe(false);
  });

  it('adds the mail cremated remains (shipping) line item when selected', () => {
    const result = calculateOrderTotals(MANORS_CATALOG, {
      weightTier: 'under_200',
      extraDeathCertificateQuantity: 0,
      mailCremated: true,
    });
    expect(result.total).toBe(89_000 + 18_500);
  });

  it('reproduces the spec\'s own worked example exactly', () => {
    // Direct Cremation $890 + Weight Surcharge $290 + 2 Death Certificates
    // $50 + Mail Cremated Remains $185 = $1,415
    const result = calculateOrderTotals(MANORS_CATALOG, {
      weightTier: '201_250',
      extraDeathCertificateQuantity: 2,
      mailCremated: true,
    });
    expect(result.total).toBe(141_500);
  });

  it('never charges for an inactive catalog service', () => {
    const catalogWithInactiveMail = MANORS_CATALOG.map((item) =>
      item.serviceCode === 'MAIL_CREMATED_REMAINS' ? { ...item, isActive: false } : item,
    );
    const result = calculateOrderTotals(catalogWithInactiveMail, {
      weightTier: 'under_200',
      extraDeathCertificateQuantity: 0,
      mailCremated: true,
    });
    expect(result.lineItems.some((l) => l.serviceCode === 'MAIL_CREMATED_REMAINS')).toBe(false);
    expect(result.total).toBe(89_000);
  });

  it('leaves discountTotal/taxTotal at 0 (no feature produces a non-zero value yet)', () => {
    const result = calculateOrderTotals(MANORS_CATALOG, {
      weightTier: 'under_200',
      extraDeathCertificateQuantity: 0,
      mailCremated: false,
    });
    expect(result.discountTotal).toBe(0);
    expect(result.taxTotal).toBe(0);
  });

  it('is a pure function of an org with a totally different catalog (future-proofing)', () => {
    const otherOrgCatalog: ServiceCatalogItem[] = [
      catalogItem({ serviceCode: 'DIRECT_BURIAL', displayName: 'Direct Burial', category: 'base', defaultPrice: 250_000, sortOrder: 1 }),
    ];
    const result = calculateOrderTotals(otherOrgCatalog, {
      weightTier: '251_300', // this org's catalog has no such code — silently produces nothing
      extraDeathCertificateQuantity: 3,
      mailCremated: true,
    });
    expect(result.lineItems).toHaveLength(0); // DIRECT_CREMATION isn't in this catalog either
    expect(result.total).toBe(0);
  });
});

describe('calculateBalance', () => {
  it('subtracts paid amount from total', () => {
    expect(calculateBalance(141_500, 50_000)).toBe(91_500);
  });

  it('never goes negative even if overpaid', () => {
    expect(calculateBalance(100, 500)).toBe(0);
  });

  it('returns the full total when nothing has been paid', () => {
    expect(calculateBalance(89_000, 0)).toBe(89_000);
  });
});

describe('calculateAdjustment', () => {
  it('returns a negative delta for a discount', () => {
    expect(calculateAdjustment('discount', 5_000)).toBe(-5_000);
  });

  it('returns a positive delta for a surcharge', () => {
    expect(calculateAdjustment('surcharge', 5_000)).toBe(5_000);
  });

  it('rejects a negative magnitude regardless of type', () => {
    expect(() => calculateAdjustment('discount', -100)).toThrow();
  });

  it('rejects a non-integer magnitude', () => {
    expect(() => calculateAdjustment('surcharge', 10.5)).toThrow();
  });
});

describe('normalizeSelections', () => {
  it('falls back to under_200/0/false for entirely missing input', () => {
    expect(normalizeSelections({})).toEqual({
      weightTier: 'under_200',
      extraDeathCertificateQuantity: 0,
      mailCremated: false,
    });
  });

  it('falls back to under_200 for an invalid weight tier rather than trusting it', () => {
    expect(normalizeSelections({ weightTier: 'over_9000' }).weightTier).toBe('under_200');
  });

  it('clamps a negative quantity to 0', () => {
    expect(normalizeSelections({ extraDeathCertificateQuantity: -5 }).extraDeathCertificateQuantity).toBe(0);
  });

  it('clamps an absurdly large quantity to the sanity ceiling (browser total tampering)', () => {
    expect(normalizeSelections({ extraDeathCertificateQuantity: 999_999 }).extraDeathCertificateQuantity).toBe(
      MAX_EXTRA_DEATH_CERTIFICATE_QUANTITY,
    );
  });

  it('truncates a fractional quantity', () => {
    expect(normalizeSelections({ extraDeathCertificateQuantity: 2.9 }).extraDeathCertificateQuantity).toBe(2);
  });

  it('only treats a literal boolean true as mailCremated', () => {
    expect(normalizeSelections({ mailCremated: 'true' }).mailCremated).toBe(false);
    expect(normalizeSelections({ mailCremated: true }).mailCremated).toBe(true);
  });
});

describe('isValidWeightTier / weightTierServiceCode', () => {
  it('accepts exactly the three known tiers', () => {
    expect(isValidWeightTier('under_200')).toBe(true);
    expect(isValidWeightTier('201_250')).toBe(true);
    expect(isValidWeightTier('251_300')).toBe(true);
    expect(isValidWeightTier('anything_else')).toBe(false);
  });

  it('maps under_200 to no service code', () => {
    expect(weightTierServiceCode('under_200')).toBeNull();
  });

  it('maps the two surcharge tiers to their service codes', () => {
    expect(weightTierServiceCode('201_250')).toBe('WEIGHT_SURCHARGE_201_250');
    expect(weightTierServiceCode('251_300')).toBe('WEIGHT_SURCHARGE_251_300');
  });
});
