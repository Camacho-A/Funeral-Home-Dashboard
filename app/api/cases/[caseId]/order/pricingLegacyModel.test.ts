import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockManagerUser, mockFuneralDirectorUser } from '@/services/__mocks__/authFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures } from '@/services/__mocks__/pricingFixtures';
import { merchandiseProductFixtures } from '@/services/__mocks__/merchandiseFixtures';

/**
 * Price catalog (2026-11) — Manors is on the 'legacy' pricing permission
 * model (its real profile, no mocking): every pricing permission it had
 * before the catalog work still applies, and none was taken away.
 * - anyone who may edit the order (caseOrder.update) still adds, changes
 *   and removes custom items;
 * - a Manager (merchandise.manage) still sets merchandise retail prices;
 * - repricing is not offered (Manors edits re-price, as always);
 * - Settings › Price Catalog's write routes do not exist for Manors.
 * Fictional amounts.
 */
let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const { POST, PATCH } = await import('./route');
const reprice = await import('./reprice/route');
const productsRoute = await import('@/app/api/merchandise/products/route');
const catalogRoute = await import('@/app/api/service-catalog/route');

const ORG = DEFAULT_ORGANIZATION_ID;
const HEADERS = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const CASE_ID = () => caseFixtures.find((c) => c.organizationId === ORG && !c.isDeleted)!.id;
const BASE = { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false, keepsakeTransferQuantity: 0, urnTransfer: false, shipping: false };
const as = (user: typeof mockDefaultUser) => {
  mockSession = { user };
};
const activeOrderId = () => caseOrderFixtures.find((o) => o.caseId === CASE_ID() && o.status === 'active')?.id;
function send(method: 'POST' | 'PATCH', selections: Record<string, unknown>) {
  const caseId = CASE_ID();
  const expectedOrderId = method === 'PATCH' ? activeOrderId() : undefined;
  return (method === 'POST' ? POST : PATCH)(
    new Request(`http://localhost/api/cases/${caseId}/order`, { method, headers: HEADERS, body: JSON.stringify({ organizationId: ORG, selections, ...(expectedOrderId ? { expectedOrderId } : {}) }) }),
    { params: Promise.resolve({ caseId }) },
  );
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  as(mockDefaultUser);
  for (const list of [caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures, merchandiseProductFixtures] as unknown[][]) list.length = 0;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  merchandiseProductFixtures.length = 0;
});

describe('Manors — pricing permissions exactly as before (legacy model)', () => {
  it('a Funeral Director (caseOrder.update) adds, changes and removes a custom item', async () => {
    as(mockFuneralDirectorUser);
    expect((await send('POST', { ...BASE, customItems: [{ id: 'c1', description: 'Extra keepsake', amountCents: 2_500 }] })).status).toBe(201);
    const line = caseOrderLineItemFixtures.find((l) => l.lineKind === 'custom')!;
    expect((await send('PATCH', { ...BASE, customItems: [{ id: line.id, description: line.description, amountCents: 3_000 }] })).status).toBe(200);
    expect((await send('PATCH', { ...BASE, customItems: [] })).status).toBe(200);
  });

  it('a Manager (merchandise.manage) sets a merchandise retail price', async () => {
    as(mockManagerUser);
    const created = await productsRoute.POST(
      new Request('http://localhost/api/merchandise/products', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ organizationId: ORG, sku: 'DEMO-URN-1', name: 'DEMO Urn', category: 'urn', cost: 1_000, retailPrice: 45_000 }),
      }),
    );
    expect(created.status).toBe(201);
  });

  it('repricing is not offered (403), and the Price Catalog write routes do not exist (404)', async () => {
    await send('POST', BASE);
    const caseId = CASE_ID();
    const refused = await reprice.POST(
      new Request(`http://localhost/api/cases/${caseId}/order/reprice`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ organizationId: ORG, expectedOrderId: activeOrderId(), confirm: true }) }),
      { params: Promise.resolve({ caseId }) },
    );
    expect(refused.status).toBe(403);
    const created = await catalogRoute.POST(
      new Request('http://localhost/api/service-catalog', { method: 'POST', headers: HEADERS, body: JSON.stringify({ organizationId: ORG, itemCode: 'DEMO_ITEM', displayName: 'DEMO', pricingType: 'flat', defaultPrice: null }) }),
    );
    expect(created.status).toBe(404);
  });
});
