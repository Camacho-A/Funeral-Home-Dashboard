import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockManagerUser, mockFuneralDirectorUser } from '@/services/__mocks__/authFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures, serviceCatalogFixtures, MANORS_SERVICE_CATALOG_ID_PREFIX } from '@/services/__mocks__/pricingFixtures';

/**
 * Price catalog (2026-11). POST /api/cases/[caseId]/order/reprice on an
 * organization with the platform pricing defaults (granular, line prices
 * locked): only a holder of caseOrder.reprice (an Administrator by
 * default) may reprice; preview writes nothing; confirm writes one new
 * version; a stale version is 409. Fictional amounts.
 */
let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));
vi.mock('@/domain/organization/organizationProfiles', async (importOriginal) =>
  (await import('@/lib/testing/granularPricingProfile')).withGranularPricing(await importOriginal(), (await import('@/services/__mocks__/organizationIds')).DEFAULT_ORGANIZATION_ID),
);

const order = await import('../route');
const { POST } = await import('./route');

const ORG = DEFAULT_ORGANIZATION_ID;
const HEADERS = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const CASE_ID = () => caseFixtures.find((c) => c.organizationId === ORG && !c.isDeleted)!.id;
const BASE = { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false, keepsakeTransferQuantity: 0, urnTransfer: false, shipping: false };
const as = (user: typeof mockDefaultUser) => {
  mockSession = { user };
};
const activeOrderId = () => caseOrderFixtures.find((o) => o.caseId === CASE_ID() && o.status === 'active')!.id;
const reprice = (body: Record<string, unknown>) =>
  POST(new Request(`http://localhost/api/cases/${CASE_ID()}/order/reprice`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ organizationId: ORG, ...body }) }), {
    params: Promise.resolve({ caseId: CASE_ID() }),
  });

let catalog: typeof serviceCatalogFixtures;
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'mock';
  catalog = structuredClone(serviceCatalogFixtures);
  for (const list of [caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures] as unknown[][]) list.length = 0;
  as(mockDefaultUser);
  await order.POST(new Request(`http://localhost/api/cases/${CASE_ID()}/order`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ organizationId: ORG, selections: BASE }) }), {
    params: Promise.resolve({ caseId: CASE_ID() }),
  });
  const base = serviceCatalogFixtures.find((i) => i.id === `${MANORS_SERVICE_CATALOG_ID_PREFIX}-direct-cremation`)!;
  base.defaultPrice = (base.defaultPrice ?? 0) + 5_000;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  serviceCatalogFixtures.splice(0, serviceCatalogFixtures.length, ...catalog);
});

describe('POST /api/cases/[caseId]/order/reprice', () => {
  it.each([
    ['Manager', mockManagerUser],
    ['Funeral Director', mockFuneralDirectorUser],
  ])('%s (no caseOrder.reprice) is refused 403, nothing written', async (_label, user) => {
    as(user);
    const before = caseOrderFixtures.length;
    expect((await reprice({ expectedOrderId: activeOrderId(), confirm: true })).status).toBe(403);
    expect(caseOrderFixtures.length).toBe(before);
  });

  it('an Administrator previews (nothing written), then confirms one new version; a stale version is 409', async () => {
    const first = activeOrderId();
    const preview = await reprice({ expectedOrderId: first, confirm: false });
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { applied: boolean; changes: unknown[] })).toMatchObject({ applied: false, changes: [{ amountDeltaCents: 5_000 }] });
    expect(caseOrderFixtures).toHaveLength(1);

    const applied = await reprice({ expectedOrderId: first, confirm: true });
    expect(applied.status).toBe(200);
    expect(caseOrderFixtures.filter((o) => o.status === 'active')).toHaveLength(1);
    expect(activeOrderId()).not.toBe(first);

    expect((await reprice({ expectedOrderId: first, confirm: true })).status).toBe(409);
    expect((await reprice({ confirm: true })).status).toBe(428);
  });
});
