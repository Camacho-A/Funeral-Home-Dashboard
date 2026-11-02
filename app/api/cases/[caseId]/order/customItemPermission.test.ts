import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import {
  mockDefaultUser,
  mockManagerUser,
  mockFuneralDirectorUser,
  mockOfficeStaffUser,
} from '@/services/__mocks__/authFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures } from '@/services/__mocks__/pricingFixtures';
import { merchandiseProductFixtures, inventoryReservationFixtures } from '@/services/__mocks__/merchandiseFixtures';

/**
 * Gus Phase 5C-3 (finalization). Over HTTP:
 * - custom (one-off, staff-priced) order items are added, changed or
 *   removed only by an Administrator or a Manager (`serviceCatalog.edit`);
 *   everyone else with `caseOrder.update` still edits orders and keeps the
 *   existing custom items exactly as they are — no API path around it;
 * - a `merchandise` list sent to the order route is ignored (merchandise
 *   only changes through the stock-reserving merchandise route);
 * - setting a merchandise retail price is administrator-only.
 * The rules are organization-generic, exercised with the Manors demo
 * fixture's full staff role set; amounts are fictional.
 */

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));
// The default fixture organization on the platform pricing defaults (granular);
// Manors' own legacy rules are covered by pricingLegacyModel.test.ts.
vi.mock('@/domain/organization/organizationProfiles', async (importOriginal) =>
  (await import('@/lib/testing/granularPricingProfile')).withGranularPricing(await importOriginal(), (await import('@/services/__mocks__/organizationIds')).DEFAULT_ORGANIZATION_ID),
);

const { POST, PATCH } = await import('./route');
const productsRoute = await import('@/app/api/merchandise/products/route');
const productRoute = await import('@/app/api/merchandise/products/[productId]/route');

const ORG = DEFAULT_ORGANIZATION_ID;
const HEADERS = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const CASE_ID = () => caseFixtures.find((c) => c.organizationId === ORG && !c.isDeleted)!.id;
const BASE = { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false, keepsakeTransferQuantity: 0, urnTransfer: false, shipping: false };
const CUSTOM = [{ id: 'c1', description: 'Extra keepsake', amountCents: 2_500 }];
const as = (user: typeof mockDefaultUser) => {
  mockSession = { user };
};

function send(method: 'POST' | 'PATCH', selections: Record<string, unknown>) {
  const caseId = CASE_ID();
  const expectedOrderId = method === 'PATCH' ? caseOrderFixtures.find((o) => o.caseId === caseId && o.status === 'active')?.id : undefined;
  return (method === 'POST' ? POST : PATCH)(
    new Request(`http://localhost/api/cases/${caseId}/order`, {
      method,
      headers: HEADERS,
      body: JSON.stringify({ organizationId: ORG, selections, ...(expectedOrderId ? { expectedOrderId } : {}) }),
    }),
    { params: Promise.resolve({ caseId }) },
  );
}
const customLines = () =>
  caseOrderLineItemFixtures
    .filter((l) => l.lineKind === 'custom' && caseOrderFixtures.some((o) => o.id === l.caseOrderId && o.status === 'active'))
    .map((l) => ({ id: l.id, description: l.description, amountCents: l.unitPrice }));

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  as(mockDefaultUser);
  for (const list of [caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures, merchandiseProductFixtures, inventoryReservationFixtures] as unknown[][]) list.length = 0;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  merchandiseProductFixtures.length = 0;
});

describe('custom order items over HTTP', () => {
  it.each([
    ['Administrator', mockDefaultUser],
    ['Manager', mockManagerUser],
  ])('%s can create an order with a custom item, then change and remove it', async (_label, user) => {
    as(user);
    expect((await send('POST', { ...BASE, customItems: CUSTOM })).status).toBe(201);
    expect((await send('PATCH', { ...BASE, customItems: [{ ...customLines()[0], amountCents: 3_000 }] })).status).toBe(200);
    expect((await send('PATCH', { ...BASE, customItems: [] })).status).toBe(200);
    expect(customLines()).toEqual([]);
  });

  it.each([
    ['Funeral Director', mockFuneralDirectorUser],
    ['Office Staff', mockOfficeStaffUser],
  ])('%s is refused (403) adding, changing or removing a custom item — and nothing is written', async (_label, user) => {
    as(user);
    const created = await send('POST', { ...BASE, customItems: CUSTOM });
    expect(created.status).toBe(403);
    expect(((await created.json()) as { reason: string }).reason).toBe('custom_item_not_permitted');
    expect(caseOrderFixtures).toHaveLength(0);

    as(mockManagerUser);
    await send('POST', { ...BASE, customItems: CUSTOM });
    const before = JSON.stringify([caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures]);
    as(user);
    const saved = customLines();
    for (const customItems of [[...saved, { id: 'x', description: 'Sneaky', amountCents: 1 }], [{ ...saved[0], amountCents: 1 }], [{ ...saved[0], description: 'Renamed' }], []]) {
      expect((await send('PATCH', { ...BASE, customItems })).status).toBe(403);
    }
    expect(JSON.stringify([caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures])).toBe(before);
  });

  it('a Funeral Director still edits the order normally, keeping the existing custom item', async () => {
    as(mockManagerUser);
    await send('POST', { ...BASE, customItems: CUSTOM });
    as(mockFuneralDirectorUser);
    expect((await send('PATCH', { ...BASE, extraDeathCertificateQuantity: 2, customItems: customLines() })).status).toBe(200);
    expect((await send('PATCH', { ...BASE, extraDeathCertificateQuantity: 3 })).status).toBe(200);
    expect(customLines().map((c) => [c.description, c.amountCents])).toEqual([['EXTRA KEEPSAKE', 2_500]]);
  });
});

describe('merchandise only changes through the inventory lifecycle', () => {
  it('a merchandise list sent to the order route is ignored — no merchandise line, no reservation', async () => {
    merchandiseProductFixtures.push({
      id: 'p1', organizationId: ORG, sku: 'DEMO-P1', name: 'DEMO Urn', description: null, category: 'urn', cost: 1, retailPrice: 45_000, taxable: false,
      isActive: true, trackInventory: false, reorderPoint: null, defaultLocationId: null, imageStorageKey: null, familyVisible: false, supplierName: null,
      supplierId: null, parentProductId: null, hasVariants: false, createdAt: '', updatedAt: '',
    } as (typeof merchandiseProductFixtures)[number]);
    const response = await send('POST', { ...BASE, merchandise: [{ productId: 'p1', locationId: 'loc-1', quantity: 1 }] });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { lineItems: Array<{ lineKind: string }> };
    expect(body.lineItems.some((l) => l.lineKind === 'merchandise')).toBe(false);
    expect(inventoryReservationFixtures).toHaveLength(0);
  });
});

describe('merchandise retail prices are administrator-only', () => {
  const product = { sku: 'DEMO-URN-1', name: 'DEMO Urn', category: 'urn', cost: 1_000, retailPrice: 45_000 };
  const create = () =>
    productsRoute.POST(new Request('http://localhost/api/merchandise/products', { method: 'POST', headers: HEADERS, body: JSON.stringify({ organizationId: ORG, ...product }) }));
  const patch = (productId: string, body: Record<string, unknown>) =>
    productRoute.PATCH(
      new Request(`http://localhost/api/merchandise/products/${productId}`, { method: 'PATCH', headers: HEADERS, body: JSON.stringify({ organizationId: ORG, ...body }) }),
      { params: Promise.resolve({ productId }) },
    );

  it('a Manager can no longer set a retail price (create or change), but can still edit other product details', async () => {
    as(mockManagerUser);
    const refused = await create();
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { reason: string }).reason).toBe('price_not_permitted');

    as(mockDefaultUser);
    const created = await create();
    expect(created.status).toBe(201);
    const { product: saved } = (await created.json()) as { product: { id: string } };

    as(mockManagerUser);
    expect((await patch(saved.id, { retailPrice: 1 })).status).toBe(403);
    expect((await patch(saved.id, { name: 'DEMO Urn Renamed' })).status).toBe(200);
    as(mockDefaultUser);
    expect((await patch(saved.id, { retailPrice: 50_000 })).status).toBe(200);
  });
});
