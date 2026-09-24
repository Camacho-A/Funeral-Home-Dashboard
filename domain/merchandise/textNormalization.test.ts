import { describe, expect, it } from 'vitest';
import { normalizeMerchandiseTextFields } from './textNormalization';

describe('normalizeMerchandiseTextFields', () => {
  it('uppercases name, description, and supplierName', () => {
    expect(
      normalizeMerchandiseTextFields({ name: 'classic wood urn', description: 'solid oak, brass inlay', supplierName: 'heritage casket co.' }),
    ).toEqual({ name: 'CLASSIC WOOD URN', description: 'SOLID OAK, BRASS INLAY', supplierName: 'HERITAGE CASKET CO.' });
  });

  it('leaves sku, prices, and ids untouched', () => {
    const result = normalizeMerchandiseTextFields({ name: 'urn', sku: 'urn-001', cost: 5000, retailPrice: 12000, id: 'prod-1' } as Record<string, unknown>);
    expect(result.sku).toBe('urn-001');
    expect(result.cost).toBe(5000);
    expect(result.retailPrice).toBe(12000);
    expect(result.id).toBe('prod-1');
  });

  it('passes a null description through unchanged', () => {
    expect(normalizeMerchandiseTextFields({ name: 'urn', description: null })).toEqual({ name: 'URN', description: null });
  });

  it('is idempotent', () => {
    const once = normalizeMerchandiseTextFields({ name: 'urn' });
    expect(normalizeMerchandiseTextFields(once)).toEqual({ name: 'URN' });
  });
});
