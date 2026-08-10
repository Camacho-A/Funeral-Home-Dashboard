import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import {
  serviceCatalogFixtures,
  caseOrderFixtures,
  caseOrderLineItemFixtures,
  caseOrderAuditFixtures,
} from './__mocks__/pricingFixtures';
import { paymentRecordFixtures } from './__mocks__/paymentFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { caseWriteOffFixtures } from './__mocks__/ledgerFixtures';
import type { PaymentRecord } from '../types/payment';
import type { CaseWriteOff } from '../types/caseWriteOff';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `id-${idCounter}`;
}

const NOW = '2026-07-20T00:00:00.000Z';

beforeEach(() => {
  idCounter = 0;
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseOrderAuditFixtures.length = 0;
  paymentRecordFixtures.length = 0;
  activityEventFixtures.length = 0;
  caseWriteOffFixtures.length = 0;
});

describe('getServiceCatalog', () => {
  it('returns only this organization\'s catalog, sorted by sortOrder ascending', async () => {
    const { getServiceCatalog } = await import('./pricingService');
    const catalog = await getServiceCatalog(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(catalog).toHaveLength(serviceCatalogFixtures.length);
    expect(catalog.every((c) => c.organizationId === DEFAULT_ORGANIZATION_ID)).toBe(true);
    const sortOrders = catalog.map((c) => c.sortOrder);
    expect(sortOrders).toEqual([...sortOrders].sort((a, b) => a - b));
  });

  it('is empty for a different organization (cross-organization isolation)', async () => {
    const { getServiceCatalog } = await import('./pricingService');
    const catalog = await getServiceCatalog(SECOND_MOCK_ORGANIZATION_ID, 'mock');
    expect(catalog).toEqual([]);
  });

  it('excludes inactive services by default', async () => {
    const { getServiceCatalog } = await import('./pricingService');
    const original = { ...serviceCatalogFixtures[0] };
    serviceCatalogFixtures[0].isActive = false;
    try {
      const catalog = await getServiceCatalog(DEFAULT_ORGANIZATION_ID, 'mock');
      expect(catalog.some((c) => c.serviceCode === original.serviceCode)).toBe(false);
      const withInactive = await getServiceCatalog(DEFAULT_ORGANIZATION_ID, 'mock', { includeInactive: true });
      expect(withInactive.some((c) => c.serviceCode === original.serviceCode)).toBe(true);
    } finally {
      serviceCatalogFixtures[0] = original;
    }
  });
});

describe('createCaseOrder', () => {
  it('creates version 1, active, with the exact spec worked example total', async () => {
    const { createCaseOrder } = await import('./pricingService');
    const { order, lineItems, auditEntry } = await createCaseOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-1',
        selections: { weightTier: '201_250', extraDeathCertificateQuantity: 2, mailCremated: true },
        performedBy: 'Jordan Ellis',
        idFactory,
        now: NOW,
      },
      'mock',
    );

    expect(order.version).toBe(1);
    expect(order.status).toBe('active');
    expect(order.total).toBe(141_500);
    expect(order.balanceDue).toBe(141_500);
    expect(lineItems).toHaveLength(4);
    expect(auditEntry.action).toBe('order_created');
    expect(auditEntry.amountDeltaCents).toBe(141_500);
  });

  it('never trusts a submitted total/amount — only selections are read', async () => {
    const { createCaseOrder } = await import('./pricingService');
    const { order } = await createCaseOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-tamper',
        // A malicious/buggy client attaching extra fields like `total` or
        // `balanceDue` must have zero effect — createCaseOrder's params
        // type doesn't even accept them, and selections is the only input.
        selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false, total: 1, balanceDue: 1 },
        performedBy: 'Jordan Ellis',
        idFactory,
        now: NOW,
      },
      'mock',
    );
    expect(order.total).toBe(89_000);
    expect(order.balanceDue).toBe(89_000);
  });

  it('clamps a browser-tampered absurd death certificate quantity', async () => {
    const { createCaseOrder } = await import('./pricingService');
    const { order } = await createCaseOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-tamper-2',
        selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 999_999, mailCremated: false },
        performedBy: 'Jordan Ellis',
        idFactory,
        now: NOW,
      },
      'mock',
    );
    expect(order.total).toBe(89_000 + 20 * 2_500); // MAX_EXTRA_DEATH_CERTIFICATE_QUANTITY = 20
  });

  it('is isolated per organization — a second org never sees the first\'s catalog prices leak in', async () => {
    const { createCaseOrder } = await import('./pricingService');
    const { order } = await createCaseOrder(
      {
        organizationId: SECOND_MOCK_ORGANIZATION_ID,
        caseId: 'case-other-org',
        selections: { weightTier: '251_300', extraDeathCertificateQuantity: 1, mailCremated: true },
        performedBy: 'Someone',
        idFactory,
        now: NOW,
      },
      'mock',
    );
    // SECOND_MOCK_ORGANIZATION_ID has no seeded catalog at all in this
    // phase's fixtures — so nothing is charged, never Manor's prices.
    expect(order.total).toBe(0);
  });
});

describe('recalculateOrder', () => {
  async function seedInitialOrder(caseId: string) {
    const { createCaseOrder } = await import('./pricingService');
    return createCaseOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId,
        selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false },
        performedBy: 'Jordan Ellis',
        idFactory,
        now: NOW,
      },
      'mock',
    );
  }

  it('returns null when the case has no active order to edit', async () => {
    const { recalculateOrder } = await import('./pricingService');
    const result = await recalculateOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'never-created',
        selections: { weightTier: '201_250', extraDeathCertificateQuantity: 0, mailCremated: false },
        performedBy: 'Jordan Ellis',
        idFactory,
      },
      'mock',
    );
    expect(result).toBeNull();
  });

  it('creates a new version, supersedes the old one, and appends audit entries', async () => {
    await seedInitialOrder('case-edit-1');
    const { recalculateOrder, getActiveCaseOrder, listCaseOrderVersions, listAuditEntriesForCase } = await import(
      './pricingService'
    );

    const result = await recalculateOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-edit-1',
        selections: { weightTier: '201_250', extraDeathCertificateQuantity: 2, mailCremated: false },
        performedBy: 'Sam Rivera',
        idFactory,
        now: '2026-07-21T00:00:00.000Z',
      },
      'mock',
    );

    expect(result).not.toBeNull();
    expect(result?.order.version).toBe(2);
    expect(result?.order.total).toBe(89_000 + 29_000 + 5_000);
    expect(result?.auditEntries.map((e) => e.action)).toEqual([
      'weight_tier_changed',
      'death_certificate_quantity_changed',
    ]);
    expect(result?.auditEntries.every((e) => e.performedBy === 'Sam Rivera')).toBe(true);

    const active = await getActiveCaseOrder(DEFAULT_ORGANIZATION_ID, 'case-edit-1', 'mock');
    expect(active?.id).toBe(result?.order.id);

    const versions = await listCaseOrderVersions(DEFAULT_ORGANIZATION_ID, 'case-edit-1', 'mock');
    expect(versions).toHaveLength(2);
    expect(versions.find((v) => v.version === 1)?.status).toBe('superseded');
    expect(versions.find((v) => v.version === 2)?.status).toBe('active');

    const auditHistory = await listAuditEntriesForCase(DEFAULT_ORGANIZATION_ID, 'case-edit-1', 'mock');
    expect(auditHistory.length).toBeGreaterThanOrEqual(3); // order_created + 2 edit entries
  });

  it('Phase 24: records exactly one case.order.changed activity event summarizing the whole recalculation', async () => {
    await seedInitialOrder('case-edit-activity-1');
    const { recalculateOrder } = await import('./pricingService');

    const result = await recalculateOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-edit-activity-1',
        selections: { weightTier: '201_250', extraDeathCertificateQuantity: 2, mailCremated: false },
        performedBy: 'Sam Rivera',
        idFactory,
        now: '2026-07-21T00:00:00.000Z',
      },
      'mock',
    );

    const events = activityEventFixtures.filter((e) => e.eventType === 'case.order.changed');
    expect(events).toHaveLength(1); // one event, not one per diff entry
    expect(events[0].category).toBe('cases');
    expect(events[0].caseId).toBe('case-edit-activity-1');
    expect(events[0].resourceId).toBe(result?.order.id);
    expect(events[0].actorIdentityId).toBe('Sam Rivera');
    expect(events[0].description).toContain('Weight');
  });

  it('Phase 24: a no-op recalculation (nothing actually changed) records no activity event', async () => {
    await seedInitialOrder('case-edit-noop-1');
    const { recalculateOrder } = await import('./pricingService');

    await recalculateOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-edit-noop-1',
        selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false },
        performedBy: 'Sam Rivera',
        idFactory,
      },
      'mock',
    );

    expect(activityEventFixtures.filter((e) => e.eventType === 'case.order.changed')).toHaveLength(0);
  });

  it('never rewrites the superseded version\'s own totals (historical immutability)', async () => {
    const { order: v1 } = await seedInitialOrder('case-edit-2');
    const { recalculateOrder } = await import('./pricingService');
    await recalculateOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-edit-2',
        selections: { weightTier: '251_300', extraDeathCertificateQuantity: 0, mailCremated: true },
        performedBy: 'Sam Rivera',
        idFactory,
        now: '2026-07-21T00:00:00.000Z',
      },
      'mock',
    );
    const stillV1 = caseOrderFixtures.find((o) => o.id === v1.id);
    expect(stillV1?.total).toBe(89_000); // unchanged from its own original calculation
    expect(stillV1?.version).toBe(1);
  });

  it('is a no-op (no new version, no audit entries) when nothing actually changed', async () => {
    await seedInitialOrder('case-edit-3');
    const { recalculateOrder } = await import('./pricingService');
    const result = await recalculateOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-edit-3',
        selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false },
        performedBy: 'Sam Rivera',
        idFactory,
      },
      'mock',
    );
    expect(result?.order.version).toBe(1);
    expect(result?.auditEntries).toEqual([]);
  });

  it('recomputes balanceDue against prior payments — a payment on v1 still counts against v2', async () => {
    const { order: v1 } = await seedInitialOrder('case-edit-4');
    const succeededPayment: PaymentRecord = {
      id: 'pay-1',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: 'case-edit-4',
      caseOrderId: v1.id,
      provider: 'clover',
      providerCheckoutId: 'checkout-1',
      providerPaymentId: 'provider-payment-1',
      idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`,
      checkoutUrl: null,
      status: 'succeeded',
      amount: 50_000,
      currency: 'usd',
      purpose: 'Deposit',
      cardBrand: null,
      cardLast4: null,
      receiptReference: null,
      failureCode: null,
      failureMessage: null,
      createdAt: NOW,
      paidAt: NOW,
      updatedAt: NOW,
      initiatedByStaffProfileId: null, depositedInBankDepositId: null,
    };
    paymentRecordFixtures.push(succeededPayment);

    const { recalculateOrder } = await import('./pricingService');
    const result = await recalculateOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-edit-4',
        selections: { weightTier: '201_250', extraDeathCertificateQuantity: 0, mailCremated: false },
        performedBy: 'Sam Rivera',
        idFactory,
        now: '2026-07-21T00:00:00.000Z',
      },
      'mock',
    );
    expect(result?.order.total).toBe(89_000 + 29_000);
    expect(result?.order.balanceDue).toBe(89_000 + 29_000 - 50_000);
  });
});

describe('getPaidAmountForCase', () => {
  it('sums only succeeded payments for the case', async () => {
    paymentRecordFixtures.push(
      {
        id: 'p1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-x', caseOrderId: null, provider: 'clover',
        providerCheckoutId: 'c1', providerPaymentId: null, idempotencyKey: 'k1', checkoutUrl: null,
        status: 'succeeded', amount: 1000, currency: 'usd', purpose: 'A', cardBrand: null, cardLast4: null,
        receiptReference: null, failureCode: null, failureMessage: null, createdAt: NOW, paidAt: NOW, updatedAt: NOW,
        initiatedByStaffProfileId: null, depositedInBankDepositId: null,
      },
      {
        id: 'p2', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-x', caseOrderId: null, provider: 'clover',
        providerCheckoutId: 'c2', providerPaymentId: null, idempotencyKey: 'k2', checkoutUrl: null,
        status: 'failed', amount: 500, currency: 'usd', purpose: 'B', cardBrand: null, cardLast4: null,
        receiptReference: null, failureCode: null, failureMessage: null, createdAt: NOW, paidAt: null, updatedAt: NOW,
        initiatedByStaffProfileId: null, depositedInBankDepositId: null,
      },
      {
        id: 'p3', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-x', caseOrderId: null, provider: 'clover',
        providerCheckoutId: 'c3', providerPaymentId: null, idempotencyKey: 'k3', checkoutUrl: null,
        status: 'succeeded', amount: 2000, currency: 'usd', purpose: 'C', cardBrand: null, cardLast4: null,
        receiptReference: null, failureCode: null, failureMessage: null, createdAt: NOW, paidAt: NOW, updatedAt: NOW,
        initiatedByStaffProfileId: null, depositedInBankDepositId: null,
      },
    );
    const { getPaidAmountForCase } = await import('./pricingService');
    expect(await getPaidAmountForCase(DEFAULT_ORGANIZATION_ID, 'case-x', 'mock')).toBe(3000);
  });
});

describe('getSatisfiedAmountForCase', () => {
  it('sums succeeded payments plus every write-off posted for the case', async () => {
    paymentRecordFixtures.push({
      id: 'p1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-y', caseOrderId: null, provider: 'clover',
      providerCheckoutId: 'c1', providerPaymentId: null, idempotencyKey: 'k1', checkoutUrl: null,
      status: 'succeeded', amount: 1000, currency: 'usd', purpose: 'A', cardBrand: null, cardLast4: null,
      receiptReference: null, failureCode: null, failureMessage: null, createdAt: NOW, paidAt: NOW, updatedAt: NOW,
      initiatedByStaffProfileId: null, depositedInBankDepositId: null,
    });
    const writeOffs: CaseWriteOff[] = [
      { id: 'wo1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-y', amount: 300, journalEntryId: 'je-1', reason: 'Uncollectible', performedByStaffProfileId: null, createdAt: NOW },
      { id: 'wo2', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-other', amount: 999, journalEntryId: 'je-2', reason: 'Different case', performedByStaffProfileId: null, createdAt: NOW },
    ];
    caseWriteOffFixtures.push(...writeOffs);

    const { getSatisfiedAmountForCase } = await import('./pricingService');
    expect(await getSatisfiedAmountForCase(DEFAULT_ORGANIZATION_ID, 'case-y', 'mock')).toBe(1300);
  });

  it('returns just the paid amount when the case has no write-offs', async () => {
    const { getSatisfiedAmountForCase } = await import('./pricingService');
    expect(await getSatisfiedAmountForCase(DEFAULT_ORGANIZATION_ID, 'case-z', 'mock')).toBe(0);
  });
});

describe('refreshBalanceForCase', () => {
  it('reduces balanceDue by a write-off, not just by succeeded payments', async () => {
    caseOrderFixtures.push({
      id: 'order-wo-1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-wo-1', status: 'active',
      subtotal: 10_000, discountTotal: 0, taxTotal: 0, total: 10_000, balanceDue: 10_000, version: 1,
      createdAt: NOW, updatedAt: NOW,
    });
    caseWriteOffFixtures.push({
      id: 'wo-refresh-1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-wo-1', amount: 4_000,
      journalEntryId: 'je-refresh-1', reason: 'Hardship write-off', performedByStaffProfileId: null, createdAt: NOW,
    });

    const { refreshBalanceForCase } = await import('./pricingService');
    const updated = await refreshBalanceForCase(DEFAULT_ORGANIZATION_ID, 'case-wo-1', 'mock');
    expect(updated?.balanceDue).toBe(6_000);
  });
});

describe('calculateTotals / calculateBalance / calculateAdjustment (re-exports)', () => {
  it('calculateTotals normalizes untrusted input the same as createCaseOrder', async () => {
    const { calculateTotals, getServiceCatalog } = await import('./pricingService');
    const catalog = await getServiceCatalog(DEFAULT_ORGANIZATION_ID, 'mock');
    const result = calculateTotals(catalog, { weightTier: 'not-real', extraDeathCertificateQuantity: -3 });
    expect(result.total).toBe(89_000); // falls back to under_200 / qty 0
  });

  it('calculateBalance and calculateAdjustment are the same pure domain functions', async () => {
    const { calculateBalance, calculateAdjustment } = await import('./pricingService');
    expect(calculateBalance(1000, 400)).toBe(600);
    expect(calculateAdjustment('discount', 100)).toBe(-100);
  });
});

describe('cross-organization isolation', () => {
  it('a CaseOrder created for one organization is invisible to another organization using the same caseId', async () => {
    const { createCaseOrder, getActiveCaseOrder, listCaseOrderVersions } = await import('./pricingService');
    const sharedCaseId = 'case-shared-id';

    await createCaseOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: sharedCaseId,
        selections: { weightTier: '251_300', extraDeathCertificateQuantity: 1, mailCremated: true },
        performedBy: 'Org A Staff',
        idFactory,
        now: NOW,
      },
      'mock',
    );

    const otherOrgOrder = await getActiveCaseOrder(SECOND_MOCK_ORGANIZATION_ID, sharedCaseId, 'mock');
    expect(otherOrgOrder).toBeNull();

    const otherOrgVersions = await listCaseOrderVersions(SECOND_MOCK_ORGANIZATION_ID, sharedCaseId, 'mock');
    expect(otherOrgVersions).toEqual([]);

    // The real owner still sees it, unaffected by the cross-org lookup.
    const ownOrder = await getActiveCaseOrder(DEFAULT_ORGANIZATION_ID, sharedCaseId, 'mock');
    expect(ownOrder).not.toBeNull();
  });

  it('recalculateOrder for one organization never edits another organization\'s order sharing the same caseId', async () => {
    const { createCaseOrder, recalculateOrder, getActiveCaseOrder } = await import('./pricingService');
    const sharedCaseId = 'case-shared-id-2';

    const { order: orgAOrder } = await createCaseOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: sharedCaseId,
        selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false },
        performedBy: 'Org A Staff',
        idFactory,
        now: NOW,
      },
      'mock',
    );

    // SECOND_MOCK_ORGANIZATION_ID has no order at all for this caseId —
    // editing on its behalf must find nothing to edit, never Org A's row.
    const result = await recalculateOrder(
      {
        organizationId: SECOND_MOCK_ORGANIZATION_ID,
        caseId: sharedCaseId,
        selections: { weightTier: '251_300', extraDeathCertificateQuantity: 5, mailCremated: true },
        performedBy: 'Org B Staff',
        idFactory,
      },
      'mock',
    );
    expect(result).toBeNull();

    const stillOrgAOrder = await getActiveCaseOrder(DEFAULT_ORGANIZATION_ID, sharedCaseId, 'mock');
    expect(stillOrgAOrder?.id).toBe(orgAOrder.id);
    expect(stillOrgAOrder?.version).toBe(1); // never touched by the other org's attempt
  });
});
