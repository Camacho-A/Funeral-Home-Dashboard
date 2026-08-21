import { describe, expect, it } from 'vitest';
import {
  MERCHANDISE_CATEGORIES,
  getMerchandiseCategoryDefinition,
  isValidMerchandiseCategoryKey,
  listMerchandiseCategories,
} from './merchandiseCategoryRegistry';

describe('merchandiseCategoryRegistry', () => {
  it('covers every required funeral-merchandise category', () => {
    const keys = Object.values(MERCHANDISE_CATEGORIES).map((c) => c.key);
    for (const required of [
      'urn',
      'casket',
      'keepsake',
      'memorial_jewelry',
      'flowers',
      'vault',
      'cremation_container',
      'clothing',
      'stationery',
      'register_book',
      'miscellaneous',
    ]) {
      expect(keys).toContain(required);
    }
  });

  it('validates known and rejects unknown keys', () => {
    expect(isValidMerchandiseCategoryKey('urn')).toBe(true);
    expect(isValidMerchandiseCategoryKey('not_a_category')).toBe(false);
  });

  it('resolves a definition by key, null otherwise', () => {
    expect(getMerchandiseCategoryDefinition('casket')?.displayName).toBe('Caskets');
    expect(getMerchandiseCategoryDefinition('nope')).toBeNull();
  });

  it('lists categories sorted by sortOrder', () => {
    const sorted = listMerchandiseCategories();
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].sortOrder).toBeGreaterThanOrEqual(sorted[i - 1].sortOrder);
    }
  });
});
