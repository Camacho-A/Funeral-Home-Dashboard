import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import {
  serviceCatalogFixtures,
  caseOrderFixtures,
  caseOrderLineItemFixtures,
  caseOrderAuditFixtures,
} from '@/services/__mocks__/pricingFixtures';

/**
 * 2026-10 (Gus Camacho Jr. service catalog). POST/PATCH
 * /api/cases/[caseId]/order refuse — 422, persisting nothing — an order
 * whose selected items include one with no price set, with a message that
 * tells staff where to fix it. Exercised against a Manors mock case by
 * temporarily clearing one of its catalog prices (the rule is generic).
 */

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { POST, PATCH } = await import('./route');

const SAME_ORIGIN_HEADERS = { origin: 'http://localhost', host: 'localhost' };
const KNOWN_CASE = () => caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)!;

function send(method: 'POST' | 'PATCH', caseId: string, selections: Record<string, unknown>) {
  const handler = method === 'POST' ? POST : PATCH;
  // A PATCH edits the version currently active (2026-10: required).
  const expectedOrderId = method === 'PATCH' ? caseOrderFixtures.find((o) => o.caseId === caseId && o.status === 'active')?.id : undefined;
  return handler(
    new Request(`http://localhost/api/cases/${caseId}/order`, {
      method,
      headers: SAME_ORIGIN_HEADERS,
      body: JSON.stringify({ organizationId: DEFAULT_ORGANIZATION_ID, selections, ...(expectedOrderId ? { expectedOrderId } : {}) }),
    }),
    { params: Promise.resolve({ caseId }) },
  );
}

function setManorsPrice(serviceCode: string, defaultPrice: number | null) {
  const index = serviceCatalogFixtures.findIndex((i) => i.organizationId === DEFAULT_ORGANIZATION_ID && i.serviceCode === serviceCode);
  serviceCatalogFixtures[index] = { ...serviceCatalogFixtures[index], defaultPrice };
}

const BASE_SELECTIONS = { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false, keepsakeTransferQuantity: 0, urnTransfer: false, shipping: false };

let catalogSnapshot: typeof serviceCatalogFixtures;
beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  catalogSnapshot = serviceCatalogFixtures.map((item) => ({ ...item }));
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseOrderAuditFixtures.length = 0;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  serviceCatalogFixtures.length = 0;
  serviceCatalogFixtures.push(...catalogSnapshot);
});

describe('case order routes — unpriced catalog items', () => {
  it('POST answers 422 with a Settings › Price Catalog message and creates no order', async () => {
    setManorsPrice('DIRECT_CREMATION', null);
    const response = await send('POST', KNOWN_CASE().id, BASE_SELECTIONS);
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string; unpricedItems: Array<{ serviceCode: string }> };
    expect(body.error).toContain('No price is set for "Direct Cremation"');
    expect(body.error).toContain('Settings › Price Catalog');
    expect(body.unpricedItems.map((i) => i.serviceCode)).toEqual(['DIRECT_CREMATION']);
    expect(caseOrderFixtures).toHaveLength(0);
    expect(caseOrderLineItemFixtures).toHaveLength(0);
  });

  it('PATCH answers 422 when an edit selects an unpriced item, leaving the active order as it was', async () => {
    const caseId = KNOWN_CASE().id;
    expect((await send('POST', caseId, BASE_SELECTIONS)).status).toBe(201);
    setManorsPrice('MAIL_CREMATED_REMAINS', null);

    const response = await send('PATCH', caseId, { ...BASE_SELECTIONS, mailCremated: true });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toContain('"Mail Cremated Remains"');
    expect(caseOrderFixtures.filter((o) => o.caseId === caseId)).toHaveLength(1);
    expect(caseOrderFixtures[0]).toMatchObject({ status: 'active', version: 1, total: 89_000 });
  });

  it('a fully priced order still saves exactly as before', async () => {
    const response = await send('POST', KNOWN_CASE().id, { ...BASE_SELECTIONS, mailCremated: true });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { order: { total: number } }).order.total).toBe(107_500);
  });
});
