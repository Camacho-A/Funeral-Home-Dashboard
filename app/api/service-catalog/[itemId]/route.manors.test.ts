import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { serviceCatalogFixtures, MANORS_SERVICE_CATALOG_ID_PREFIX } from '@/services/__mocks__/pricingFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

/**
 * Settings › Services & Pricing is off for Manors (its profile): the price
 * route answers 404 and changes nothing, whatever the caller's permissions.
 */
vi.mock('@/lib/auth/session', () => ({ getSession: async () => ({ user: mockDefaultUser }) }));
const { PATCH } = await import('./route');

const itemId = `${MANORS_SERVICE_CATALOG_ID_PREFIX}-direct-cremation`;

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  activityEventFixtures.length = 0;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
});

describe('PATCH /api/service-catalog/[itemId] — Manors', () => {
  it('is not offered (404) and writes nothing', async () => {
    const before = serviceCatalogFixtures.find((i) => i.id === itemId)?.defaultPrice;
    const response = await PATCH(
      new Request(`http://localhost/api/service-catalog/${itemId}`, {
        method: 'PATCH',
        headers: { origin: 'http://localhost', host: 'localhost' },
        body: JSON.stringify({ organizationId: DEFAULT_ORGANIZATION_ID, defaultPrice: 91_000 }),
      }),
      { params: Promise.resolve({ itemId }) },
    );
    expect(response.status).toBe(404);
    expect(serviceCatalogFixtures.find((i) => i.id === itemId)?.defaultPrice).toBe(before);
    expect(activityEventFixtures).toHaveLength(0);
  });
});
