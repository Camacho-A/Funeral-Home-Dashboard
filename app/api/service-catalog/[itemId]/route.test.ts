import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, GUS_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockReadOnlyUser, mockOfficeStaffUser } from '@/services/__mocks__/authFixtures';
import { serviceCatalogFixtures, gusServiceCatalogItemId, MANORS_SERVICE_CATALOG_ID_PREFIX } from '@/services/__mocks__/pricingFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

/**
 * 2026-10 (Gus Camacho Jr. service catalog). PATCH /api/service-catalog/[itemId]
 * — Settings › Services & Pricing price editing: auth, permission
 * (`serviceCatalog.edit`), organization scoping, validation, and mock
 * persistence.
 */

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

// These cases exercise the route itself on the default mock organization
// (Manors' fixtures), so price editing is switched on for it here; the real
// Manors profile keeps it off (see route.manors.test.ts).
const priceEditing = vi.hoisted(() => ({ on: true }));
vi.mock('@/domain/organization/organizationProfiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/organization/organizationProfiles')>();
  return {
    ...actual,
    getRegisteredOrganizationProfile: (organizationId: string) => {
      const profile = actual.getRegisteredOrganizationProfile(organizationId);
      return { ...profile, features: { ...profile.features, serviceCatalogPriceEditing: priceEditing.on } };
    },
  };
});

const { PATCH } = await import('./route');

const SAME_ORIGIN_HEADERS = { origin: 'http://localhost', host: 'localhost' };
const MANORS_DIRECT_CREMATION_ID = `${MANORS_SERVICE_CATALOG_ID_PREFIX}-direct-cremation`;

function patch(itemId: string, body: unknown, headers: Record<string, string> = SAME_ORIGIN_HEADERS) {
  return PATCH(
    new Request(`http://localhost/api/service-catalog/${itemId}`, { method: 'PATCH', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ itemId }) },
  );
}

let catalogSnapshot: typeof serviceCatalogFixtures;
beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  catalogSnapshot = serviceCatalogFixtures.map((item) => ({ ...item }));
  activityEventFixtures.length = 0;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  serviceCatalogFixtures.length = 0;
  serviceCatalogFixtures.push(...catalogSnapshot);
});

describe('PATCH /api/service-catalog/[itemId]', () => {
  it('401 with no session', async () => {
    mockSession = null;
    expect((await patch(MANORS_DIRECT_CREMATION_ID, { organizationId: DEFAULT_ORGANIZATION_ID, defaultPrice: 1 })).status).toBe(401);
  });

  it('403 on a cross-site request (CSRF)', async () => {
    const response = await patch(MANORS_DIRECT_CREMATION_ID, { organizationId: DEFAULT_ORGANIZATION_ID, defaultPrice: 1 }, { origin: 'https://evil.example', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('403 for an organization the caller is not a member of', async () => {
    const response = await patch(gusServiceCatalogItemId('DIRECT_CREMATION'), { organizationId: GUS_ORGANIZATION_ID, defaultPrice: 1 });
    expect(response.status).toBe(403);
    expect(serviceCatalogFixtures.find((i) => i.id === gusServiceCatalogItemId('DIRECT_CREMATION'))?.defaultPrice).toBeNull();
  });

  it('403 for a member without serviceCatalog.edit (Read Only, Office Staff)', async () => {
    for (const user of [mockReadOnlyUser, mockOfficeStaffUser]) {
      mockSession = { user };
      const response = await patch(MANORS_DIRECT_CREMATION_ID, { organizationId: DEFAULT_ORGANIZATION_ID, defaultPrice: 1 });
      expect(response.status, user.email).toBe(403);
    }
    expect(serviceCatalogFixtures.find((i) => i.id === MANORS_DIRECT_CREMATION_ID)?.defaultPrice).toBe(89_000);
  });

  it("404 for another organization's item id (cross-org), leaving that row untouched", async () => {
    const gusItemId = gusServiceCatalogItemId('CREMATION_WITH_VIEWING');
    const response = await patch(gusItemId, { organizationId: DEFAULT_ORGANIZATION_ID, defaultPrice: 123_400 });
    expect(response.status).toBe(404);
    expect(serviceCatalogFixtures.find((i) => i.id === gusItemId)?.defaultPrice).toBeNull();
    expect(activityEventFixtures).toHaveLength(0);
  });

  it('404 for an unknown item id', async () => {
    expect((await patch('no-such-item', { organizationId: DEFAULT_ORGANIZATION_ID, defaultPrice: 1 })).status).toBe(404);
  });

  it('400 for malformed input', async () => {
    expect((await patch(MANORS_DIRECT_CREMATION_ID, 'not json')).status).toBe(400);
    expect((await patch(MANORS_DIRECT_CREMATION_ID, { defaultPrice: 1 })).status).toBe(400);
    for (const defaultPrice of [-1, 10.5, '100', 100_000_001, true]) {
      const response = await patch(MANORS_DIRECT_CREMATION_ID, { organizationId: DEFAULT_ORGANIZATION_ID, defaultPrice });
      expect(response.status, String(defaultPrice)).toBe(400);
    }
    expect((await patch(MANORS_DIRECT_CREMATION_ID, { organizationId: DEFAULT_ORGANIZATION_ID })).status).toBe(400);
    expect(serviceCatalogFixtures.find((i) => i.id === MANORS_DIRECT_CREMATION_ID)?.defaultPrice).toBe(89_000);
  });

  it('200 sets the price in mock persistence and records an activity event; null clears it', async () => {
    const set = await patch(MANORS_DIRECT_CREMATION_ID, { organizationId: DEFAULT_ORGANIZATION_ID, defaultPrice: 91_000 });
    expect(set.status).toBe(200);
    expect(((await set.json()) as { item: { defaultPrice: number } }).item.defaultPrice).toBe(91_000);
    expect(serviceCatalogFixtures.find((i) => i.id === MANORS_DIRECT_CREMATION_ID)?.defaultPrice).toBe(91_000);
    expect(activityEventFixtures.map((e) => e.eventType)).toEqual(['serviceCatalog.price.updated']);

    const cleared = await patch(MANORS_DIRECT_CREMATION_ID, { organizationId: DEFAULT_ORGANIZATION_ID, defaultPrice: null });
    expect(cleared.status).toBe(200);
    expect(serviceCatalogFixtures.find((i) => i.id === MANORS_DIRECT_CREMATION_ID)?.defaultPrice).toBeNull();
  });
});
