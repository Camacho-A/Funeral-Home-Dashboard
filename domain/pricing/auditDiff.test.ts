import { describe, expect, it } from 'vitest';
import type { ServiceCatalogItem } from '../../types/serviceCatalog';
import { diffSelections } from './auditDiff';

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

const CATALOG: ServiceCatalogItem[] = [
  catalogItem({ serviceCode: 'DIRECT_CREMATION', displayName: 'Direct Cremation', category: 'base', defaultPrice: 89_000, sortOrder: 1 }),
  catalogItem({ serviceCode: 'WEIGHT_SURCHARGE_201_250', category: 'weight_surcharge', defaultPrice: 29_000, sortOrder: 2 }),
  catalogItem({ serviceCode: 'WEIGHT_SURCHARGE_251_300', category: 'weight_surcharge', defaultPrice: 39_000, sortOrder: 2 }),
  catalogItem({ serviceCode: 'EXTRA_DEATH_CERTIFICATE', pricingType: 'per_unit', defaultPrice: 2_500, sortOrder: 3 }),
  catalogItem({ serviceCode: 'MAIL_CREMATED_REMAINS', defaultPrice: 18_500, sortOrder: 4 }),
];

describe('diffSelections', () => {
  it('produces no entries when nothing changed', () => {
    const s = { weightTier: 'under_200' as const, extraDeathCertificateQuantity: 0, mailCremated: false };
    expect(diffSelections(CATALOG, s, { ...s })).toEqual([]);
  });

  it('records a weight tier change with the exact spec example format', () => {
    const entries = diffSelections(
      CATALOG,
      { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false },
      { weightTier: '201_250', extraDeathCertificateQuantity: 0, mailCremated: false },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('weight_tier_changed');
    expect(entries[0].amountDeltaCents).toBe(29_000);
    expect(entries[0].description).toBe('Changed: Weight, Under 200 lb → 201–250 lb, +$290');
  });

  it('records a negative delta when moving to a cheaper (or no) surcharge tier', () => {
    const entries = diffSelections(
      CATALOG,
      { weightTier: '251_300', extraDeathCertificateQuantity: 0, mailCremated: false },
      { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false },
    );
    expect(entries[0].amountDeltaCents).toBe(-39_000);
    expect(entries[0].description).toContain('-$390');
  });

  it('records an added death certificate quantity matching the spec example', () => {
    const entries = diffSelections(
      CATALOG,
      { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false },
      { weightTier: 'under_200', extraDeathCertificateQuantity: 2, mailCremated: false },
    );
    expect(entries[0].action).toBe('death_certificate_quantity_changed');
    expect(entries[0].amountDeltaCents).toBe(5_000);
    expect(entries[0].description).toBe('Added: 2 Death Certificates, +$50');
  });

  it('records a removed death certificate with singular wording for quantity 1', () => {
    const entries = diffSelections(
      CATALOG,
      { weightTier: 'under_200', extraDeathCertificateQuantity: 3, mailCremated: false },
      { weightTier: 'under_200', extraDeathCertificateQuantity: 2, mailCremated: false },
    );
    expect(entries[0].description).toBe('Removed: 1 Death Certificate, -$25');
  });

  it('records mail cremated remains added/removed', () => {
    const added = diffSelections(
      CATALOG,
      { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false },
      { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: true },
    );
    expect(added[0].action).toBe('mail_cremated_remains_added');
    expect(added[0].amountDeltaCents).toBe(18_500);

    const removed = diffSelections(
      CATALOG,
      { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: true },
      { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false },
    );
    expect(removed[0].action).toBe('mail_cremated_remains_removed');
    expect(removed[0].amountDeltaCents).toBe(-18_500);
  });

  it('produces multiple entries when several things change at once', () => {
    const entries = diffSelections(
      CATALOG,
      { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false },
      { weightTier: '251_300', extraDeathCertificateQuantity: 1, mailCremated: true },
    );
    expect(entries.map((e) => e.action)).toEqual([
      'weight_tier_changed',
      'death_certificate_quantity_changed',
      'mail_cremated_remains_added',
    ]);
  });
});
