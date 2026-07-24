import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import {
  caseOrderFixtures,
  caseOrderLineItemFixtures,
  caseOrderAuditFixtures,
} from '@/services/__mocks__/pricingFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

let mockQueryWixDataItems = vi.fn();
let mockInsertWixDataItem = vi.fn();
let mockUpdateWixDataItem = vi.fn();
vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  return {
    queryWixDataItems: (...args: unknown[]) => {
      getWixServerConfig();
      return mockQueryWixDataItems(...args);
    },
    insertWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockInsertWixDataItem(...args);
    },
    updateWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockUpdateWixDataItem(...args);
    },
  };
});

const { GET, POST, PATCH } = await import('./route');

const KNOWN_CASE = () => caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)!;

function getRequest(caseId: string, organizationId: string | null) {
  const url = organizationId
    ? `http://localhost/api/cases/${caseId}/order?organizationId=${organizationId}`
    : `http://localhost/api/cases/${caseId}/order`;
  return GET(new Request(url), { params: Promise.resolve({ caseId }) });
}

function postRequest(caseId: string, body: unknown) {
  return POST(new Request(`http://localhost/api/cases/${caseId}/order`, { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId }),
  });
}

function patchRequest(caseId: string, body: unknown) {
  return PATCH(new Request(`http://localhost/api/cases/${caseId}/order`, { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId }),
  });
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseOrderAuditFixtures.length = 0;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseOrderAuditFixtures.length = 0;
});

describe('GET /api/cases/[caseId]/order', () => {
  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await getRequest(KNOWN_CASE().id, DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('returns 403 for a forged organizationId', async () => {
    expect((await getRequest(KNOWN_CASE().id, SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns null order for a case with no order yet', async () => {
    const response = await getRequest(KNOWN_CASE().id, DEFAULT_ORGANIZATION_ID);
    const body = (await response.json()) as { order: unknown };
    expect(body.order).toBeNull();
  });
});

describe('POST /api/cases/[caseId]/order', () => {
  it('returns 401 with no session', async () => {
    mockSession = null;
    const response = await postRequest(KNOWN_CASE().id, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false },
      performedBy: 'Jordan Ellis',
    });
    expect(response.status).toBe(401);
  });

  it('returns 404 for a case that does not belong to this organization', async () => {
    const response = await postRequest('not-a-real-case', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false },
      performedBy: 'Jordan Ellis',
    });
    expect(response.status).toBe(404);
  });

  it('returns 400 when selections is missing', async () => {
    const response = await postRequest(KNOWN_CASE().id, { organizationId: DEFAULT_ORGANIZATION_ID, performedBy: 'X' });
    expect(response.status).toBe(400);
  });

  it('creates a case order with server-calculated totals, ignoring a submitted total', async () => {
    const caseId = KNOWN_CASE().id;
    const response = await postRequest(caseId, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      selections: {
        weightTier: '201_250',
        extraDeathCertificateQuantity: 2,
        mailCremated: true,
        total: 1, // tampered — must be ignored entirely
        balanceDue: 1,
      },
      performedBy: 'Jordan Ellis',
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { order: { total: number; balanceDue: number }; lineItems: unknown[] };
    expect(body.order.total).toBe(141_500);
    expect(body.order.balanceDue).toBe(141_500);
    expect(body.lineItems).toHaveLength(4);
  });

  it('returns 409 if the case already has an active order', async () => {
    const caseId = KNOWN_CASE().id;
    const create = () =>
      postRequest(caseId, {
        organizationId: DEFAULT_ORGANIZATION_ID,
        selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false },
        performedBy: 'Jordan Ellis',
      });
    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(409);
  });
});

describe('PATCH /api/cases/[caseId]/order', () => {
  it('returns 404 when the case has no order to edit', async () => {
    const response = await patchRequest(KNOWN_CASE().id, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      selections: { weightTier: '201_250', extraDeathCertificateQuantity: 0, mailCremated: false },
      performedBy: 'Jordan Ellis',
    });
    expect(response.status).toBe(404);
  });

  it('creates a new version and records audit entries, never mutating history', async () => {
    const caseId = KNOWN_CASE().id;
    const created = await postRequest(caseId, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false },
      performedBy: 'Jordan Ellis',
    });
    const createdBody = (await created.json()) as { order: { id: string; version: number } };

    const edited = await patchRequest(caseId, {
      organizationId: DEFAULT_ORGANIZATION_ID,
      selections: { weightTier: '251_300', extraDeathCertificateQuantity: 1, mailCremated: false },
      performedBy: 'Sam Rivera',
    });
    expect(edited.status).toBe(200);
    const editedBody = (await edited.json()) as {
      order: { id: string; version: number; total: number };
      auditEntries: Array<{ action: string }>;
    };
    expect(editedBody.order.version).toBe(2);
    expect(editedBody.order.id).not.toBe(createdBody.order.id);
    expect(editedBody.order.total).toBe(89_000 + 39_000 + 2_500);
    expect(editedBody.auditEntries.map((e) => e.action)).toEqual([
      'weight_tier_changed',
      'death_certificate_quantity_changed',
    ]);

    const originalStillExists = caseOrderFixtures.find((o) => o.id === createdBody.order.id);
    expect(originalStillExists?.status).toBe('superseded');
    expect(originalStillExists?.total).toBe(89_000); // never rewritten
  });
});

/**
 * Real-Wix-mode smoke test: exercises lib/wixCaseOrderMapper.ts,
 * lib/wixCaseOrderLineItemMapper.ts, and lib/wixCaseOrderAuditMapper.ts
 * against an in-memory stand-in for the live collections, the same
 * approach the checkout route's own wix-mode tests use. Mock-mode above
 * already exhaustively covers the business logic (createCaseOrder/
 * recalculateOrder/diffing/balances) that both modes share; this
 * confirms the mapper round-trip specifically, since that's the one
 * thing that differs between modes.
 */
describe('GET /api/cases/[caseId]/order — wix mode (mapper round-trip)', () => {
  const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
  let originalEnv: Record<string, string | undefined>;
  let store: Record<string, Record<string, Record<string, unknown>>>;

  beforeEach(() => {
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';

    store = { caseOrders: {}, caseOrderLineItems: {}, caseOrderAuditEntries: {} };
    mockQueryWixDataItems = vi.fn().mockImplementation((collectionId: string, opts?: { filter?: Record<string, unknown> }) => {
      const filter = opts?.filter ?? {};
      const items = Object.entries(store[collectionId] ?? {})
        .filter(([, data]) => Object.entries(filter).every(([k, v]) => data[k] === v))
        .map(([id, data]) => ({ id, dataCollectionId: collectionId, data }));
      return Promise.resolve({ dataItems: items });
    });
    mockInsertWixDataItem = vi.fn();
    mockUpdateWixDataItem = vi.fn();
  });

  afterEach(() => {
    ENV_KEYS.forEach((key) => {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  it('maps a real Wix caseOrders/caseOrderLineItems/caseOrderAuditEntries shape correctly', async () => {
    store.caseOrders['wix-item-1'] = {
      beaconCaseOrderId: 'order-1',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: 'case-1',
      status: 'active',
      subtotal: 118_000,
      discountTotal: 0,
      taxTotal: 0,
      total: 118_000,
      balanceDue: 118_000,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    store.caseOrderLineItems['wix-li-1'] = {
      beaconLineItemId: 'li-1',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseOrderId: 'order-1',
      serviceCode: 'DIRECT_CREMATION',
      description: 'Direct Cremation',
      quantity: 1,
      unitPrice: 89_000,
      lineTotal: 89_000,
      sortOrder: 1,
      metadata: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    store.caseOrderAuditEntries['wix-audit-1'] = {
      beaconAuditEntryId: 'audit-1',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: 'case-1',
      caseOrderId: 'order-1',
      action: 'order_created',
      previousValue: null,
      newValue: null,
      amountDeltaCents: 118_000,
      description: 'Case order created — 1 service',
      performedBy: 'Jordan Ellis',
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    const response = await getRequest('case-1', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      order: { id: string; total: number; balanceDue: number } | null;
      lineItems: Array<{ id: string; description: string }>;
      auditEntries: Array<{ id: string; action: string }>;
    };
    expect(body.order?.id).toBe('order-1');
    expect(body.order?.total).toBe(118_000);
    expect(body.lineItems).toHaveLength(1);
    expect(body.lineItems[0].description).toBe('Direct Cremation');
    expect(body.auditEntries).toHaveLength(1);
    expect(body.auditEntries[0].action).toBe('order_created');
  });

  it('never leaks another organization\'s caseOrders row even when queried by the same caseId', async () => {
    store.caseOrders['wix-item-1'] = {
      beaconCaseOrderId: 'order-1',
      organizationId: SECOND_MOCK_ORGANIZATION_ID,
      caseId: 'case-1',
      status: 'active',
      subtotal: 100,
      discountTotal: 0,
      taxTotal: 0,
      total: 100,
      balanceDue: 100,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const response = await getRequest('case-1', DEFAULT_ORGANIZATION_ID);
    const body = (await response.json()) as { order: unknown };
    expect(body.order).toBeNull();
  });
});
