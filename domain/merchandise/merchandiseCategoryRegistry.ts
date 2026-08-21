/**
 * Phase 35 (Merchandise, Inventory & Commerce). The stable, machine-readable
 * product-category taxonomy every `MerchandiseProduct.category` picks exactly
 * one entry from — mirrors `domain/scheduling/appointmentTypeRegistry.ts`'s
 * `APPOINTMENT_TYPES` convention (dot-free stable keys, a separate
 * `displayName` never derived from the key, this registry as the source of
 * truth rather than a hardcoded union on the type itself).
 *
 * Unlike `ServiceCatalogItem.category` (a deliberately OPEN string, since
 * services are a per-org, freely-extensible price list), merchandise
 * categories are a CLOSED union: they drive product filters, category-scoped
 * reports, and family-facing grouping, so an unknown category is a
 * validation error at the service boundary, not a silently-uncharged row.
 * Adding a category later is a new entry here — never a data-model change.
 */
export const MERCHANDISE_CATEGORIES = {
  URN: { key: 'urn', displayName: 'Urns', sortOrder: 1 },
  CASKET: { key: 'casket', displayName: 'Caskets', sortOrder: 2 },
  VAULT: { key: 'vault', displayName: 'Vaults', sortOrder: 3 },
  CREMATION_CONTAINER: { key: 'cremation_container', displayName: 'Cremation Containers', sortOrder: 4 },
  KEEPSAKE: { key: 'keepsake', displayName: 'Keepsakes', sortOrder: 5 },
  MEMORIAL_JEWELRY: { key: 'memorial_jewelry', displayName: 'Memorial Jewelry', sortOrder: 6 },
  FLOWERS: { key: 'flowers', displayName: 'Flowers', sortOrder: 7 },
  CLOTHING: { key: 'clothing', displayName: 'Clothing', sortOrder: 8 },
  STATIONERY: { key: 'stationery', displayName: 'Stationery', sortOrder: 9 },
  REGISTER_BOOK: { key: 'register_book', displayName: 'Register Books', sortOrder: 10 },
  MISCELLANEOUS: { key: 'miscellaneous', displayName: 'Miscellaneous', sortOrder: 11 },
} as const;

export type MerchandiseCategoryDefinition = (typeof MERCHANDISE_CATEGORIES)[keyof typeof MERCHANDISE_CATEGORIES];
export type MerchandiseCategoryKey = MerchandiseCategoryDefinition['key'];

const CATEGORIES_BY_KEY: Record<string, MerchandiseCategoryDefinition> = Object.fromEntries(
  Object.values(MERCHANDISE_CATEGORIES).map((entry) => [entry.key, entry]),
);

export function isValidMerchandiseCategoryKey(key: string): key is MerchandiseCategoryKey {
  return key in CATEGORIES_BY_KEY;
}

export function getMerchandiseCategoryDefinition(key: string): MerchandiseCategoryDefinition | null {
  return CATEGORIES_BY_KEY[key] ?? null;
}

/** Every category, sorted for catalog/report display. */
export function listMerchandiseCategories(): MerchandiseCategoryDefinition[] {
  return Object.values(MERCHANDISE_CATEGORIES).slice().sort((a, b) => a.sortOrder - b.sortOrder);
}
