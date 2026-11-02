import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, GUS_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import {
  mockDefaultUser,
  mockManagerUser,
  mockFuneralDirectorUser,
  mockOfficeStaffUser,
  mockReadOnlyUser,
  mockAccountingUser,
} from '@/services/__mocks__/authFixtures';
import { serviceCatalogFixtures, serviceCatalogCategoryFixtures, gusCatalogCategoryId, MANORS_SERVICE_CATALOG_ID_PREFIX } from '@/services/__mocks__/pricingFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

/**
 * Gus Phase 5C-3 (administrator-managed price catalog). The Settings › Price
 * Catalog routes: who may view and who may change the catalog (the server is
 * the boundary — serviceCatalog.edit + organization.manage), organization
 * scoping, validation, revision conflicts and audit. Mock data; the
 * organization-generic rules are exercised with the Manors demo fixture's
 * full role set, which has every staff role.
 */

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));
// The default fixture organization on the platform pricing defaults (granular).
vi.mock('@/domain/organization/organizationProfiles', async (importOriginal) =>
  (await import('@/lib/testing/granularPricingProfile')).withGranularPricing(await importOriginal(), (await import('@/services/__mocks__/organizationIds')).DEFAULT_ORGANIZATION_ID),
);

const listRoute = await import('./route');
const itemRoute = await import('./[itemId]/route');
const categoriesRoute = await import('./categories/route');
const categoryRoute = await import('./categories/[categoryId]/route');

const SAME_ORIGIN = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const ORG = DEFAULT_ORGANIZATION_ID;
const send = (url: string, method: string, body: unknown, headers: Record<string, string> = SAME_ORIGIN) =>
  new Request(`http://localhost${url}`, { method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

const api = {
  list: (query = '') => listRoute.GET(new Request(`http://localhost/api/service-catalog?organizationId=${ORG}${query}`)),
  create: (body: Record<string, unknown>, headers?: Record<string, string>) =>
    listRoute.POST(send('/api/service-catalog', 'POST', { organizationId: ORG, itemCode: 'DEMO_ITEM', displayName: 'DEMO Item', pricingType: 'flat', defaultPrice: 1_000, ...body }, headers)),
  patch: (itemId: string, body: Record<string, unknown>) =>
    itemRoute.PATCH(send(`/api/service-catalog/${itemId}`, 'PATCH', { organizationId: ORG, ...body }), { params: Promise.resolve({ itemId }) }),
  createCategory: (body: Record<string, unknown>) => categoriesRoute.POST(send('/api/service-catalog/categories', 'POST', { organizationId: ORG, ...body })),
  patchCategory: (categoryId: string, body: Record<string, unknown>) =>
    categoryRoute.PATCH(send(`/api/service-catalog/categories/${categoryId}`, 'PATCH', { organizationId: ORG, ...body }), { params: Promise.resolve({ categoryId }) }),
};

const as = (user: typeof mockDefaultUser | null) => {
  mockSession = user ? { user } : null;
};

let catalogSnapshot: typeof serviceCatalogFixtures;
let categorySnapshot: typeof serviceCatalogCategoryFixtures;
beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  as(mockDefaultUser);
  catalogSnapshot = serviceCatalogFixtures.map((item) => ({ ...item }));
  categorySnapshot = serviceCatalogCategoryFixtures.map((category) => ({ ...category }));
  activityEventFixtures.length = 0;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  serviceCatalogFixtures.splice(0, serviceCatalogFixtures.length, ...catalogSnapshot);
  serviceCatalogCategoryFixtures.splice(0, serviceCatalogCategoryFixtures.length, ...categorySnapshot);
});

const NON_ADMINS = [
  ['Funeral Director', mockFuneralDirectorUser],
  ['Office Staff', mockOfficeStaffUser],
  ['Accounting', mockAccountingUser],
  ['Read Only', mockReadOnlyUser],
] as const;

describe('who may change the price catalog', () => {
  it('an administrator can add an item (201), and it is audited', async () => {
    const response = await api.create({});
    expect(response.status).toBe(201);
    const { item } = (await response.json()) as { item: { serviceCode: string; organizationId: string } };
    expect(item).toMatchObject({ serviceCode: 'DEMO_ITEM', organizationId: ORG });
    expect(activityEventFixtures.map((e) => e.eventType)).toEqual(['serviceCatalog.item.created']);
  });

  it.each(NON_ADMINS)('%s gets 403 on every write, and nothing changes', async (_label, user) => {
    const existing = `${MANORS_SERVICE_CATALOG_ID_PREFIX}-direct-cremation`;
    as(user);
    expect((await api.create({})).status).toBe(403);
    expect((await api.patch(existing, { defaultPrice: 1, expectedRevision: 0 })).status).toBe(403);
    expect((await api.patch(existing, { isActive: false })).status).toBe(403);
    expect((await api.createCategory({ name: 'DEMO' })).status).toBe(403);
    expect(serviceCatalogFixtures).toEqual(catalogSnapshot);
    expect(serviceCatalogCategoryFixtures).toEqual(categorySnapshot);
    expect(activityEventFixtures).toHaveLength(0);
  });

  it('a Manager maintains items and categories, but cannot change prices or deactivate items (platform defaults)', async () => {
    const existing = `${MANORS_SERVICE_CATALOG_ID_PREFIX}-direct-cremation`;
    as(mockManagerUser);
    expect((await api.create({})).status).toBe(403); // carries a price
    expect((await api.patch(existing, { defaultPrice: 1, expectedRevision: 0 })).status).toBe(403);
    expect((await api.patch(existing, { isActive: false })).status).toBe(403);
    expect(serviceCatalogFixtures).toEqual(catalogSnapshot);
    expect((await api.create({ defaultPrice: null })).status).toBe(201);
    expect((await api.createCategory({ name: 'DEMO' })).status).toBe(201);
  });

  it('401 with no session; 403 cross-site; 403 for an organization the caller is not a member of', async () => {
    as(null);
    expect((await api.create({})).status).toBe(401);
    as(mockDefaultUser);
    expect((await api.create({}, { origin: 'https://evil.example', host: 'localhost', 'content-type': 'application/json' })).status).toBe(403);
    expect((await listRoute.POST(send('/api/service-catalog', 'POST', { organizationId: GUS_ORGANIZATION_ID, itemCode: 'X1', displayName: 'X', pricingType: 'flat' }))).status).toBe(403);
    expect(serviceCatalogFixtures).toEqual(catalogSnapshot);
  });
});

describe('who may view it', () => {
  it('any member gets the active catalog and categories; includeInactive takes serviceCatalog.read', async () => {
    await api.create({});
    const created = serviceCatalogFixtures.find((i) => i.serviceCode === 'DEMO_ITEM')!;
    await api.patch(created.id, { isActive: false, expectedRevision: 0 });

    as(mockFuneralDirectorUser);
    const active = (await (await api.list()).json()) as { catalog: Array<{ serviceCode: string }>; categories: unknown[] };
    expect(active.catalog.some((i) => i.serviceCode === 'DEMO_ITEM')).toBe(false);
    expect(Array.isArray(active.categories)).toBe(true);
    const all = (await (await api.list('&includeInactive=1')).json()) as { catalog: Array<{ serviceCode: string }> };
    expect(all.catalog.some((i) => i.serviceCode === 'DEMO_ITEM')).toBe(true);

    as(mockAccountingUser); // holds no serviceCatalog.read
    expect((await api.list('&includeInactive=1')).status).toBe(403);
    expect((await api.list()).status).toBe(200);
  });
});

describe('validation, conflicts and scoping', () => {
  it('duplicate code 409; invalid input 400; wrong-organization item 404', async () => {
    expect((await api.create({})).status).toBe(201);
    const duplicate = await api.create({ itemCode: 'demo_item' });
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { reason: string }).reason).toBe('duplicate_code');
    for (const body of [{ defaultPrice: -100 }, { defaultPrice: 12.5 }, { itemCode: 'bad code' }, { displayName: '' }, { pricingType: 'tiered' }]) {
      expect((await api.create({ itemCode: 'DEMO_OTHER', ...body })).status, JSON.stringify(body)).toBe(400);
    }
    expect((await listRoute.POST(send('/api/service-catalog', 'POST', 'not json'))).status).toBe(400);
    expect((await api.patch(`${GUS_ORGANIZATION_ID}-svc-direct-cremation`, { defaultPrice: 1 })).status).toBe(404);
  });

  it('a stale expectedRevision is 409 and the first save wins', async () => {
    await api.create({});
    const item = serviceCatalogFixtures.find((i) => i.serviceCode === 'DEMO_ITEM')!;
    expect((await api.patch(item.id, { defaultPrice: 2_000, expectedRevision: 0 })).status).toBe(200);
    const second = await api.patch(item.id, { defaultPrice: 3_000, expectedRevision: 0 });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { reason: string }).reason).toBe('revision_conflict');
    expect(serviceCatalogFixtures.find((i) => i.id === item.id)?.defaultPrice).toBe(2_000);
  });

  it('PATCH with nothing to change, or an immutable field, is 400', async () => {
    await api.create({});
    const item = serviceCatalogFixtures.find((i) => i.serviceCode === 'DEMO_ITEM')!;
    expect((await api.patch(item.id, {})).status).toBe(400);
    expect((await api.patch(item.id, { pricingType: 'per_unit', expectedRevision: 0 })).status).toBe(400);
    expect((await api.patch(item.id, { serviceCode: 'NEW', expectedRevision: 0 })).status).toBe(400);
  });
  // Live (Wix) data refuses every non-price write (501): covered in
  // services/priceCatalogService.test.ts — mock sign-in is never allowed
  // with live data, so a route test can't reach that branch.
});

describe('category routes', () => {
  it('an administrator adds and renames a category; a duplicate name is 409; another organization\'s is 404', async () => {
    const created = await api.createCategory({ name: 'DEMO Keepsakes' });
    expect(created.status).toBe(201);
    const { category } = (await created.json()) as { category: { id: string; revision: number } };
    expect((await api.createCategory({ name: 'demo keepsakes' })).status).toBe(409);
    expect((await api.patchCategory(category.id, { name: 'DEMO Memorials', expectedRevision: 0 })).status).toBe(200);
    expect((await api.patchCategory(category.id, { name: 'Again', expectedRevision: 0 })).status).toBe(409);
    expect((await api.patchCategory(category.id, { color: 'red', expectedRevision: 1 })).status).toBe(400);
    expect((await api.patchCategory(gusCatalogCategoryId('Merchandise'), { name: 'X', expectedRevision: 0 })).status).toBe(404);
    expect(activityEventFixtures.map((e) => e.eventType)).toEqual(['serviceCatalog.category.created', 'serviceCatalog.category.updated']);
  });
});
