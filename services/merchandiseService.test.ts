import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { merchandiseProductFixtures } from './__mocks__/merchandiseFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { ACTIVITY_EVENT_TYPES } from '../types/activityEvent';
import {
  createProduct,
  updateProduct,
  setProductArchived,
  listProductsForOrganization,
  listActiveProductsForOrganization,
  getProductById,
  MerchandiseServiceError,
} from './merchandiseService';

let idCounter = 0;
const idFactory = () => `prod-${(idCounter += 1)}`;
const NOW = '2026-08-19T00:00:00.000Z';
const CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'identity-1', actorMembershipId: null, actorRoleKey: null, correlationId: 'corr-1' };

beforeEach(() => {
  idCounter = 0;
  merchandiseProductFixtures.length = 0;
  activityEventFixtures.length = 0;
});

function baseInput(overrides: Record<string, unknown> = {}) {
  return { organizationId: DEFAULT_ORGANIZATION_ID, sku: 'URN-OAK', name: 'Oak Urn', category: 'urn', cost: 15000, retailPrice: 39000, idFactory, now: NOW, ...overrides };
}

describe('merchandiseService create', () => {
  it('creates an active product and records a merchandise.product.created event', async () => {
    const product = await createProduct(baseInput(), CTX, 'mock');
    expect(product.isActive).toBe(true);
    expect(product.sku).toBe('URN-OAK');
    expect(product.trackInventory).toBe(true);
    expect(product.familyVisible).toBe(false);
    expect(product.parentProductId).toBeNull();
    expect(activityEventFixtures.some((e) => e.eventType === ACTIVITY_EVENT_TYPES.MERCHANDISE_PRODUCT_CREATED)).toBe(true);
  });

  it('rejects a duplicate SKU within the same organization', async () => {
    await createProduct(baseInput(), CTX, 'mock');
    await expect(createProduct(baseInput({ name: 'Another Oak Urn' }), CTX, 'mock')).rejects.toMatchObject({ code: 'duplicate_sku' });
  });

  it('allows the same SKU in a different organization (tenant isolation)', async () => {
    await createProduct(baseInput(), CTX, 'mock');
    const other = await createProduct(baseInput({ organizationId: SECOND_MOCK_ORGANIZATION_ID }), { ...CTX, organizationId: SECOND_MOCK_ORGANIZATION_ID }, 'mock');
    expect(other.organizationId).toBe(SECOND_MOCK_ORGANIZATION_ID);
  });

  it('rejects an unknown category and a non-integer/negative price', async () => {
    await expect(createProduct(baseInput({ category: 'spaceship' }), CTX, 'mock')).rejects.toBeInstanceOf(MerchandiseServiceError);
    await expect(createProduct(baseInput({ retailPrice: -1 }), CTX, 'mock')).rejects.toBeInstanceOf(MerchandiseServiceError);
    await expect(createProduct(baseInput({ cost: 1.5 }), CTX, 'mock')).rejects.toBeInstanceOf(MerchandiseServiceError);
  });
});

describe('merchandiseService update/archive/reads', () => {
  it('updates mutable fields and records only the changed ones', async () => {
    const product = await createProduct(baseInput(), CTX, 'mock');
    activityEventFixtures.length = 0;
    const updated = await updateProduct(DEFAULT_ORGANIZATION_ID, product.id, { retailPrice: 42000, name: 'Oak Urn' /* unchanged */ }, CTX, 'mock');
    expect(updated.retailPrice).toBe(42000);
    const event = activityEventFixtures.find((e) => e.eventType === ACTIVITY_EVENT_TYPES.MERCHANDISE_PRODUCT_UPDATED);
    expect(event).toBeDefined();
    // name was unchanged, so it is not in the change set
    expect(event!.newValue).toContain('retailPrice');
    expect(event!.newValue).not.toContain('"name"');
  });

  it('archives a product without deleting it, and excludes it from active reads', async () => {
    const product = await createProduct(baseInput(), CTX, 'mock');
    await setProductArchived(DEFAULT_ORGANIZATION_ID, product.id, true, CTX, 'mock');
    expect(await getProductById(DEFAULT_ORGANIZATION_ID, product.id, 'mock')).not.toBeNull(); // still exists
    expect(await listActiveProductsForOrganization(DEFAULT_ORGANIZATION_ID, 'mock')).toHaveLength(0);
    expect(await listProductsForOrganization(DEFAULT_ORGANIZATION_ID, 'mock', { includeInactive: true })).toHaveLength(1);
    expect(activityEventFixtures.some((e) => e.eventType === ACTIVITY_EVENT_TYPES.MERCHANDISE_PRODUCT_ARCHIVED)).toBe(true);
  });

  it('getProductById is organization-scoped', async () => {
    const product = await createProduct(baseInput(), CTX, 'mock');
    expect(await getProductById(SECOND_MOCK_ORGANIZATION_ID, product.id, 'mock')).toBeNull();
  });
});
