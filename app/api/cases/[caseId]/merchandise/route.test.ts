import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureIdentitySession } from '@/lib/auth/testing/fixtureIdentityAuth';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures } from '@/services/__mocks__/pricingFixtures';

/**
 * Non-destructive order versioning (2026-10, docs/ORDER_VERSIONING.md):
 * the case merchandise routes never let a stale view replace a newer order
 * version. Mock data only.
 */

vi.mock('@/lib/auth/session', () => ({
  getSession: async () => fixtureIdentitySession(mockDefaultUser),
  createSession: async () => undefined,
  clearSession: async () => undefined,
}));
vi.mock('@/lib/auth/resolveIdentitySession', async () => (await import('@/lib/auth/testing/fixtureIdentityAuth')).fixtureResolveIdentitySessionModule);
vi.mock('@/services/membershipService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/membershipService')>()),
  listMembershipsForIdentity: (await import('@/lib/auth/testing/fixtureIdentityAuth')).fixtureListMembershipsForIdentity,
}));

const syncReservation = vi.fn();
const releaseReservation = vi.fn();
const returnFulfilled = vi.fn(async () => ({ onHand: 1 }));
vi.mock('@/services/inventoryService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/inventoryService')>()),
  syncReservation: (...args: unknown[]) => syncReservation(...args),
  releaseReservation: (...args: unknown[]) => releaseReservation(...args),
  listReservationsForCase: async () => [],
  returnFulfilled: (...args: unknown[]) => returnFulfilled(...(args as [])),
}));
vi.mock('@/services/authorizationPolicyService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/authorizationPolicyService')>()),
  canEditCaseOrder: async () => true,
  canManageInventory: async () => true,
}));
vi.mock('@/services/staffProfileService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/staffProfileService')>()),
  resolveStaffProfileForCaller: async () => null,
}));

/** Lets a test make "someone else's edit" land right after the route has
    read the active order (the return route's race). */
let afterActiveRead: (() => Promise<void>) | null = null;
vi.mock('@/services/pricingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/pricingService')>();
  return {
    ...actual,
    getActiveCaseOrder: async (...args: Parameters<typeof actual.getActiveCaseOrder>) => {
      const order = await actual.getActiveCaseOrder(...args);
      const hook = afterActiveRead;
      afterActiveRead = null;
      if (hook) await hook();
      return order;
    },
  };
});

const { POST } = await import('./route');
const { POST: RETURN } = await import('./return/route');
const pricing = await import('@/services/pricingService');

const HEADERS = { origin: 'http://localhost', host: 'localhost' };
const KNOWN_CASE = () => caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)!;
const BASE = { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false };
let n = 0;
const idFactory = () => `merch-test-${++n}`;

function post(caseId: string, body: Record<string, unknown>) {
  return POST(new Request(`http://localhost/api/cases/${caseId}/merchandise`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId }),
  });
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseOrderAuditFixtures.length = 0;
  syncReservation.mockReset();
  releaseReservation.mockReset();
  returnFulfilled.mockClear();
  afterActiveRead = null;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseOrderAuditFixtures.length = 0;
});

async function seedOrder(caseId: string) {
  return (await pricing.createCaseOrder({ organizationId: DEFAULT_ORGANIZATION_ID, caseId, selections: BASE, performedBy: 'staff', idFactory }, 'mock')).order;
}

describe('POST /api/cases/[caseId]/merchandise', () => {
  it('refuses a list that names no order version (428) — no reservation, no new version', async () => {
    const caseId = KNOWN_CASE().id;
    await seedOrder(caseId);
    const response = await post(caseId, { organizationId: DEFAULT_ORGANIZATION_ID, items: [] });
    expect(response.status).toBe(428);
    expect(syncReservation).not.toHaveBeenCalled();
    expect(releaseReservation).not.toHaveBeenCalled();
    expect(caseOrderFixtures).toHaveLength(1);
  });

  it('refuses a stale list (409, current order) BEFORE any reservation changes', async () => {
    const caseId = KNOWN_CASE().id;
    const v1 = await seedOrder(caseId);
    const v2 = await pricing.recalculateOrder({ organizationId: DEFAULT_ORGANIZATION_ID, caseId, selections: { ...BASE, mailCremated: true }, performedBy: 'staff', idFactory, expectedOrderId: v1.id }, 'mock');
    const response = await post(caseId, { organizationId: DEFAULT_ORGANIZATION_ID, items: [], expectedOrderId: v1.id });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { reason: string; order: { id: string } };
    expect(body).toMatchObject({ reason: 'order_conflict', order: { id: v2!.order.id } });
    expect(syncReservation).not.toHaveBeenCalled();
    expect(releaseReservation).not.toHaveBeenCalled();
    expect(caseOrderFixtures).toHaveLength(2);
  });

  it('accepts a list pinned to the active version', async () => {
    const caseId = KNOWN_CASE().id;
    const v1 = await seedOrder(caseId);
    const response = await post(caseId, { organizationId: DEFAULT_ORGANIZATION_ID, items: [], expectedOrderId: v1.id });
    expect(response.status).toBe(200);
  });
});

describe('POST /api/cases/[caseId]/merchandise/return', () => {
  it('recomputes from the new active version when another edit lands mid-request — the other edit is preserved', async () => {
    const caseId = KNOWN_CASE().id;
    const v1 = await seedOrder(caseId);
    // Right after the route reads v1, someone else adds Mail Cremated Remains (v2).
    afterActiveRead = async () => {
      await pricing.recalculateOrder({ organizationId: DEFAULT_ORGANIZATION_ID, caseId, selections: { ...BASE, mailCremated: true }, performedBy: 'other', idFactory, expectedOrderId: v1.id }, 'mock');
    };
    const response = await RETURN(
      new Request(`http://localhost/api/cases/${caseId}/merchandise/return`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ organizationId: DEFAULT_ORGANIZATION_ID, productId: 'p-1', locationId: 'loc-1' }),
      }),
      { params: Promise.resolve({ caseId }) },
    );
    expect(response.status).toBe(200);
    const active = await pricing.getActiveCaseOrder(DEFAULT_ORGANIZATION_ID, caseId, 'mock');
    // The concurrent edit (v2 with mail) is still the active order — the
    // return never replaced it with a list computed from v1.
    expect(active?.version).toBe(2);
    const lines = await pricing.listLineItemsForOrder(DEFAULT_ORGANIZATION_ID, active!.id, 'mock');
    expect(lines.some((line) => line.serviceCode === 'MAIL_CREMATED_REMAINS')).toBe(true);
    expect(caseOrderFixtures.filter((o) => o.caseId === caseId && o.status === 'active')).toHaveLength(1);
  });
});
