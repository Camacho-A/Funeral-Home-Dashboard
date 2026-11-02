import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockManagerUser, mockFuneralDirectorUser } from '@/services/__mocks__/authFixtures';
import { catalogPriceChangeFixtures, serviceCatalogFixtures, MANORS_SERVICE_CATALOG_ID_PREFIX } from '@/services/__mocks__/pricingFixtures';
import type { CatalogPriceChange } from '@/types/catalogPriceChange';

/**
 * Price catalog (2026-11) — server-side enforcement on an organization
 * configured like Gus: platform pricing defaults (granular) plus Gus's
 * standing "catalog changes are Administrator-only" Manager override.
 * Covers the price history recovery route and the catalog write route.
 * Fictional data only.
 */
let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));
vi.mock('@/domain/organization/organizationProfiles', async (importOriginal) => {
  const { DEFAULT_ORGANIZATION_ID: ORG } = await import('@/services/__mocks__/organizationIds');
  const granular = (await import('@/lib/testing/granularPricingProfile')).withGranularPricing(await importOriginal(), ORG);
  return {
    ...granular,
    getRegisteredOrganizationProfile: (id: string | null | undefined) => {
      const profile = granular.getRegisteredOrganizationProfile(id);
      if (id !== ORG) return profile;
      return {
        ...profile,
        features: {
          ...profile.features,
          standingRoleOverrides: [{ roleKey: 'manager', permissionKey: 'serviceCatalog.edit', action: 'revoke', reason: 'Gus-like test configuration.' }],
        },
      };
    },
  };
});

const reconcile = await import('./route');
const history = await import('../route');
const item = await import('../../[itemId]/route');

const ORG = DEFAULT_ORGANIZATION_ID;
const HEADERS = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const ITEM_ID = `${MANORS_SERVICE_CATALOG_ID_PREFIX}-direct-cremation`;
const as = (user: typeof mockDefaultUser) => {
  mockSession = { user };
};
const getReport = () => reconcile.GET(new Request(`http://localhost/api/service-catalog/price-history/reconcile?organizationId=${ORG}`));
const postRepair = () => reconcile.POST(new Request('http://localhost/api/service-catalog/price-history/reconcile', { method: 'POST', headers: HEADERS, body: JSON.stringify({ organizationId: ORG }) }));
const patchItem = (body: Record<string, unknown>) =>
  item.PATCH(new Request(`http://localhost/api/service-catalog/${ITEM_ID}`, { method: 'PATCH', headers: HEADERS, body: JSON.stringify({ organizationId: ORG, ...body }) }), {
    params: Promise.resolve({ itemId: ITEM_ID }),
  });

const interrupted = (): CatalogPriceChange => ({
  id: 'cpc-fictional-interrupted', organizationId: ORG, itemType: 'service', itemId: ITEM_ID, itemCode: 'DIRECT_CREMATION', itemName: 'Direct Cremation',
  previousPrice: 100_000, newPrice: 125_000, changedBy: 'identity-fictional', changedAt: '2026-01-01T00:00:00.000Z', reason: null, correlationId: 'corr-fictional',
  status: 'pending', outcome: null, settledAt: null, requestKey: null,
});

let catalog: typeof serviceCatalogFixtures;
beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  catalog = structuredClone(serviceCatalogFixtures);
  catalogPriceChangeFixtures.length = 0;
  as(mockDefaultUser);
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  serviceCatalogFixtures.splice(0, serviceCatalogFixtures.length, ...catalog);
  catalogPriceChangeFixtures.length = 0;
});

describe('price history recovery route', () => {
  it.each([
    ['Manager', mockManagerUser],
    ['Funeral Director', mockFuneralDirectorUser],
  ])('%s is refused (403) for the report and the repair; nothing changes', async (_label, user) => {
    catalogPriceChangeFixtures.push(interrupted());
    as(user);
    expect((await getReport()).status).toBe(403);
    expect((await postRepair()).status).toBe(403);
    expect(catalogPriceChangeFixtures[0].status).toBe('pending');
  });

  it('an Administrator sees the interrupted change, then settles it from the item (never changing a price)', async () => {
    catalogPriceChangeFixtures.push(interrupted());
    const priceBefore = serviceCatalogFixtures.find((i) => i.id === ITEM_ID)!.defaultPrice;

    const report = await getReport();
    expect(report.status).toBe(200);
    expect(((await report.json()) as { report: { pending: unknown[] } }).report.pending).toEqual([expect.objectContaining({ id: 'cpc-fictional-interrupted', resolution: 'not_applied' })]);
    expect(catalogPriceChangeFixtures[0].status).toBe('pending');

    expect((await postRepair()).status).toBe(200);
    expect(catalogPriceChangeFixtures[0]).toMatchObject({ status: 'not_applied', outcome: 'reconciled_not_applied' });
    expect(serviceCatalogFixtures.find((i) => i.id === ITEM_ID)!.defaultPrice).toBe(priceBefore);
  });

  it("another organization's price history is refused — the requested organizationId is never trusted on its own", async () => {
    for (const other of ['gus-camacho-jr', 'evergreen-memorial-group']) {
      const report = await reconcile.GET(new Request(`http://localhost/api/service-catalog/price-history/reconcile?organizationId=${other}`));
      expect([403, 404], other).toContain(report.status);
      const repair = await reconcile.POST(new Request('http://localhost/api/service-catalog/price-history/reconcile', { method: 'POST', headers: HEADERS, body: JSON.stringify({ organizationId: other }) }));
      expect([403, 404], other).toContain(repair.status);
      const list = await history.GET(new Request(`http://localhost/api/service-catalog/price-history?organizationId=${other}&itemType=service&itemId=${ITEM_ID}`));
      expect([403, 404], other).toContain(list.status);
    }
  });

  it('refuses a cross-site POST', async () => {
    const response = await reconcile.POST(new Request('http://localhost/api/service-catalog/price-history/reconcile', {
      method: 'POST', headers: { ...HEADERS, origin: 'https://elsewhere.example' }, body: JSON.stringify({ organizationId: ORG }),
    }));
    expect(response.status).toBe(403);
  });
});

describe('catalog write route — Gus-like configuration', () => {
  it('a Manager cannot edit the catalog (standing override) or change a price; an Administrator can', async () => {
    as(mockManagerUser);
    expect((await patchItem({ displayName: 'Renamed by manager' })).status).toBe(403);
    expect((await patchItem({ defaultPrice: 91_000 })).status).toBe(403);
    expect(serviceCatalogFixtures.find((i) => i.id === ITEM_ID)!.displayName).not.toBe('Renamed by manager');

    as(mockDefaultUser);
    expect((await patchItem({ defaultPrice: 91_000 })).status).toBe(200);
    expect(serviceCatalogFixtures.find((i) => i.id === ITEM_ID)!.defaultPrice).toBe(91_000);
    expect(catalogPriceChangeFixtures).toEqual([expect.objectContaining({ newPrice: 91_000, status: 'applied' })]);
  });
});
